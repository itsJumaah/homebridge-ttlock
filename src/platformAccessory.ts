import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { TtlockPlatform } from './platform';
import { LockResponse } from './models/lock-response';
import { Lock } from './models/lock';
import { TtlockApiClient } from './api';
import axios from 'axios';
import qs from 'qs';

interface LockStateResponse {
  state: number;
}

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class TtlockPlatformAccessory {
  private service: Service;

  private batteryService: Service;

  private Characteristic = this.platform.api.hap.Characteristic;

  private apiClient = new TtlockApiClient(this.platform);

  private lastStateFetch = 0;

  private lastStateValue: number | null = null;

  private lastTargetStateValue: number | null = null;

  private lastBatteryFetch = 0;

  private lastBatteryLevelValue: number | null = null;

  private stateFetchPromise: Promise<number> | null = null;

  private batteryFetchPromise: Promise<number> | null = null;

  private commandQueue: Promise<void> = Promise.resolve();

  private gatewayBusyBackoffUntil = 0;

  private stateConfirmationTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Set possible states of the lock
   */
  public lockStates = {
    Locked: true,
  };

  constructor(
    private readonly platform: TtlockPlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'TTLock Homebridge Platform')
      .setCharacteristic(this.platform.Characteristic.Model, this.getLockModel())
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.lockMac);

    // get the LockMechanism service if it exists, otherwise create a new LockMechanism service
    this.service = this.accessory.getService(this.platform.Service.LockMechanism) ||
    this.accessory.addService(this.platform.Service.LockMechanism);

    // set the service name, this is what is displayed as the default name on the Home app
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.lockAlias);
    this.removeLegacyBatteryCharacteristics();

    this.batteryService = this.accessory.getService(this.platform.Service.Battery) ||
    this.accessory.addService(this.platform.Service.Battery);
    this.batteryService.setCharacteristic(this.platform.Characteristic.Name, `${accessory.context.device.lockAlias} Battery`);

    // register handlers for the Target State Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.LockTargetState)
      .onSet(this.handleLockTargetStateSet.bind(this))
      .onGet(this.handleLockTargetStateGet.bind(this));

    // register handlers for the Lock Current State Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.LockCurrentState)
      .onGet(this.handleLockCurrentStateGet.bind(this));

    this.batteryService.getCharacteristic(this.platform.Characteristic.BatteryLevel)
      .onGet(this.handleLockBatteryLevelGet.bind(this));

    this.batteryService.getCharacteristic(this.platform.Characteristic.StatusLowBattery)
      .onGet(this.handleLockStatusLowBatteryGet.bind(this));

    this.refreshBatteryIfStaleInBackground();
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory.
   */
  async handleLockTargetStateSet(value: CharacteristicValue) {
    const requestedTargetState = Number(value);
    const targetState = this.Characteristic.LockTargetState;

    if (requestedTargetState !== targetState.SECURED && requestedTargetState !== targetState.UNSECURED) {
      this.platform.log.warn(`${this.accessory.context.device.lockAlias} received unsupported target state: ${requestedTargetState}`);
      return;
    }

    const queuedCommand = this.commandQueue
      .catch(() => undefined)
      .then(async () => await this.setLockTargetState(requestedTargetState));

    this.commandQueue = queuedCommand.catch(() => undefined);
    await queuedCommand;
  }

  /**
   * Handle the "GET" requests from HomeKit
   * These are sent when HomeKit wants to know the current target state of the accessory.
   */
  async handleLockTargetStateGet(): Promise<CharacteristicValue> {
    const currentValue = await this.getLockCurrentState();
    const targetValue = this.getTargetStateFromCurrentState(currentValue);

    this.lastTargetStateValue = targetValue;
    this.updateLockCharacteristics(currentValue, targetValue);

    return targetValue;
  }

  /**
   * Handle the "GET" requests from HomeKit
   * These are sent when HomeKit wants to know the current state of the accessory.
   */
  async handleLockCurrentStateGet(): Promise<CharacteristicValue> {
    const currentValue = await this.getLockCurrentState();
    const targetValue = this.getTargetStateFromCurrentState(currentValue);

    this.lastTargetStateValue = targetValue;
    this.updateLockCharacteristics(currentValue, targetValue);

    return currentValue;
  }

  async handleLockBatteryLevelGet(): Promise<CharacteristicValue> {
    const now = new Date().getTime();

    if (this.lastBatteryLevelValue !== null && now - this.lastBatteryFetch < this.getBatteryCacheMs()) {
      this.updateBatteryCharacteristics(this.lastBatteryLevelValue);
      return this.lastBatteryLevelValue;
    }

    if (this.batteryFetchPromise) {
      return await this.batteryFetchPromise;
    }

    this.batteryFetchPromise = this.fetchBatteryLevel();

    try {
      return await this.batteryFetchPromise;
    } finally {
      this.batteryFetchPromise = null;
    }
  }

  async handleLockStatusLowBatteryGet(): Promise<CharacteristicValue> {
    const batteryLevel = Number(await this.handleLockBatteryLevelGet());

    return this.getLowBatteryValue(batteryLevel);
  }

  private async setLockTargetState(requestedTargetState: number) {
    const urlString = requestedTargetState === this.Characteristic.LockTargetState.SECURED ? 'lock' : 'unlock';
    const previousCurrentStateValue = this.lastStateValue ?? this.getAssumedCurrentState();
    const previousTargetStateValue = this.lastTargetStateValue ?? this.getTargetStateFromCurrentState(previousCurrentStateValue);
    const nextCurrentStateValue = this.getCurrentStateFromTargetState(requestedTargetState);
    const lockId = this.accessory.context.device.lockId;
    const backoffRemainingMs = this.getGatewayBusyBackoffRemainingMs();

    if (backoffRemainingMs > 0) {
      this.platform.log.warn(
        `${this.accessory.context.device.lockAlias} ${urlString} skipped; gateway busy backoff has `
        + `${Math.ceil(backoffRemainingMs / 1000)}s remaining.`,
      );
      this.restoreLockState(previousCurrentStateValue, previousTargetStateValue);
      return;
    }

    try {
      const accessToken = await this.apiClient.getAccessTokenAsync(Number(this.platform.config.maximumApiRetry));
      const now = new Date().getTime();

      const response = await axios.post<LockResponse>(`https://euapi.ttlock.com/v3/lock/${urlString}`, qs.stringify({
        clientId: this.platform.config.clientid,
        accessToken: accessToken,
        lockId: lockId,
        date: now,
      }), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: this.getCommandTimeoutMs(),
      });

      this.platform.log.debug(`https://euapi.ttlock.com/v3/lock/${urlString}`);
      this.platform.log.debug(JSON.stringify(response.data));
      this.platform.log.debug('Returned: ' + String(response.data.errcode));

      // API returns error code 0 if the request was accepted.
      if (response.data.errcode === 0) {
        this.setCachedCurrentState(nextCurrentStateValue);
        this.lastTargetStateValue = requestedTargetState;
        this.updateLockCharacteristics(nextCurrentStateValue, requestedTargetState);
        this.scheduleStateConfirmation(nextCurrentStateValue);
        this.platform.log.info(this.accessory.context.device.lockAlias + ' ' + urlString + 'ed successfully.');
      } else {
        this.handleLockCommandError(response.data);
        this.restoreLockState(previousCurrentStateValue, previousTargetStateValue);
      }

    } catch (e) {
      this.platform.log.warn(
        `${this.accessory.context.device.lockAlias} ${urlString} failed: ${this.getHttpErrorMessage(e)}`,
      );
      this.restoreLockState(previousCurrentStateValue, previousTargetStateValue);

    } finally {
      this.platform.log.debug('Finished handling lock state change');
    }
  }

  private getLockModel(): string {
    const lockVersion = this.accessory.context.device.lockVersion;
    const groupId = Array.isArray(lockVersion) ? lockVersion[0]?.groupId : lockVersion?.groupId;
    const model = String(groupId || '').trim();

    return model.length > 0 ? model : 'TTLock';
  }

  private async getLockCurrentState(): Promise<number> {
    const now = new Date().getTime();

    if (this.lastStateValue !== null && now - this.lastStateFetch < this.getStateCacheMs()) {
      return this.lastStateValue;
    }

    if (this.stateFetchPromise) {
      return await this.stateFetchPromise;
    }

    this.stateFetchPromise = this.fetchLockCurrentState();

    try {
      return await this.stateFetchPromise;
    } finally {
      this.stateFetchPromise = null;
    }
  }

  private async fetchLockCurrentState(): Promise<number> {
    const currentValue = this.lastStateValue ?? this.getAssumedCurrentState();
    const clientId = this.platform.config.clientid;
    const lockId = this.accessory.context.device.lockId;

    try {
      const accessToken = await this.apiClient.getAccessTokenAsync(Number(this.platform.config.maximumApiRetry));
      const now = new Date().getTime();
      const response = await axios.get<LockStateResponse>(`https://euapi.ttlock.com/v3/lock/queryOpenState?${qs.stringify({
        clientId: clientId,
        accessToken: accessToken,
        lockId: lockId,
        date: now,
      })}`, {
        timeout: this.getApiTimeoutMs(),
      });
      const lockStateValue = Number(response.data.state);
      const currentLockStateValue = this.getCurrentStateFromApiState(lockStateValue);

      this.platform.log.debug('Lock state is: ' + String(response.data.state));
      this.setCachedCurrentState(currentLockStateValue);

      return currentLockStateValue;

    } catch (e) {
      this.platform.log.warn(`Error while getting status via API: ${this.getHttpErrorMessage(e)}`);

      if (this.lastStateValue !== null) {
        this.lastStateFetch = new Date().getTime();
      }

      return currentValue;
    }
  }

  private async fetchBatteryLevel(): Promise<number> {
    let currentBatteryLevelValue = this.lastBatteryLevelValue ?? 0;
    const clientId = this.platform.config.clientid;
    const lockId = this.accessory.context.device.lockId;

    try {
      const accessToken = await this.apiClient.getAccessTokenAsync(Number(this.platform.config.maximumApiRetry));
      const now = new Date().getTime();
      const response = await axios.get<Lock>(`https://euapi.ttlock.com/v3/lock/detail?${qs.stringify({
        clientId: clientId,
        accessToken: accessToken,
        lockId: lockId,
        date: now,
      })}`, {
        timeout: this.getApiTimeoutMs(),
      });
      const batteryLevel = Number(response.data.electricQuantity);

      currentBatteryLevelValue = Number.isFinite(batteryLevel) ? Math.max(0, Math.min(100, batteryLevel)) : 0;
      this.lastBatteryLevelValue = currentBatteryLevelValue;
      this.lastBatteryFetch = new Date().getTime();
      this.platform.log.debug('Lock battery level is: ' + String(response.data.electricQuantity));

    } catch (e) {
      this.platform.log.warn(`Error while getting battery level via API: ${this.getHttpErrorMessage(e)}`);
    }

    this.updateBatteryCharacteristics(currentBatteryLevelValue);
    return currentBatteryLevelValue;
  }

  private scheduleStateConfirmation(expectedCurrentStateValue: number) {
    const delayMs = this.getConfirmationDelayMs();

    if (delayMs <= 0) {
      return;
    }

    if (this.stateConfirmationTimer) {
      clearTimeout(this.stateConfirmationTimer);
    }

    this.stateConfirmationTimer = setTimeout(() => {
      this.stateConfirmationTimer = null;
      void this.confirmLockState(expectedCurrentStateValue);
    }, delayMs);
  }

  private async confirmLockState(expectedCurrentStateValue: number) {
    const confirmedCurrentStateValue = await this.fetchLockCurrentState();
    const confirmedTargetStateValue = this.getTargetStateFromCurrentState(confirmedCurrentStateValue);

    this.lastTargetStateValue = confirmedTargetStateValue;
    this.updateLockCharacteristics(confirmedCurrentStateValue, confirmedTargetStateValue);

    if (confirmedCurrentStateValue !== expectedCurrentStateValue) {
      this.platform.log.warn(
        `${this.accessory.context.device.lockAlias} confirmed state does not match the requested state. HomeKit was corrected.`,
      );
    }
  }

  private refreshBatteryIfStaleInBackground() {
    if (this.lastBatteryLevelValue !== null && new Date().getTime() - this.lastBatteryFetch < this.getBatteryCacheMs()) {
      return;
    }

    setTimeout(() => {
      void this.handleLockBatteryLevelGet();
    }, 5000);
  }

  private handleLockCommandError(response: LockResponse) {
    if (response.errcode === -3003) {
      this.gatewayBusyBackoffUntil = new Date().getTime() + this.getGatewayBusyBackoffMs();
    }

    this.platform.log.warn(
      `${this.accessory.context.device.lockAlias} command failed: ${this.describeTtlockError(response)}`,
    );
  }

  private describeTtlockError(response: LockResponse): string {
    const details = [response.errmsg, response.description].filter(Boolean).join(' - ');

    switch (response.errcode) {
      case -3003:
        return details ? `Gateway busy (${details})` : 'Gateway busy';
      case 0:
        return 'Success';
      default:
        return details ? `TTLock error ${response.errcode}: ${details}` : `TTLock error ${response.errcode}`;
    }
  }

  private getHttpErrorMessage(e: unknown): string {
    if (axios.isAxiosError(e)) {
      if (e.code === 'ECONNABORTED') {
        return `TTLock API timed out after ${this.getApiTimeoutMs() / 1000}s`;
      }

      if (e.response?.status) {
        return `HTTP ${e.response.status}: ${e.message}`;
      }

      return e.message;
    }

    return String(e);
  }

  private getAssumedCurrentState(): number {
    return this.lockStates.Locked
      ? this.Characteristic.LockCurrentState.SECURED
      : this.Characteristic.LockCurrentState.UNSECURED;
  }

  private getCurrentStateFromTargetState(targetStateValue: number): number {
    return targetStateValue === this.Characteristic.LockTargetState.SECURED
      ? this.Characteristic.LockCurrentState.SECURED
      : this.Characteristic.LockCurrentState.UNSECURED;
  }

  private getTargetStateFromCurrentState(currentStateValue: number): number {
    if (currentStateValue === this.Characteristic.LockCurrentState.SECURED) {
      return this.Characteristic.LockTargetState.SECURED;
    }

    if (currentStateValue === this.Characteristic.LockCurrentState.UNSECURED) {
      return this.Characteristic.LockTargetState.UNSECURED;
    }

    return this.lastTargetStateValue ?? this.Characteristic.LockTargetState.SECURED;
  }

  private getCurrentStateFromApiState(lockStateValue: number): number {
    switch (lockStateValue) {
      case 0:
        this.lockStates.Locked = true;
        return this.Characteristic.LockCurrentState.SECURED;
      case 1:
        this.lockStates.Locked = false;
        return this.Characteristic.LockCurrentState.UNSECURED;
      default:
        this.platform.log.warn(`${this.accessory.context.device.lockAlias} returned unknown lock state: ${lockStateValue}`);
        return this.lastStateValue ?? this.Characteristic.LockCurrentState.UNKNOWN;
    }
  }

  private setCachedCurrentState(currentStateValue: number) {
    this.lastStateValue = currentStateValue;
    this.lastStateFetch = new Date().getTime();

    if (currentStateValue === this.Characteristic.LockCurrentState.SECURED) {
      this.lockStates.Locked = true;
    } else if (currentStateValue === this.Characteristic.LockCurrentState.UNSECURED) {
      this.lockStates.Locked = false;
    }
  }

  private updateLockCharacteristics(currentStateValue: number, targetStateValue: number) {
    this.service.getCharacteristic(this.platform.Characteristic.LockCurrentState).updateValue(currentStateValue);
    this.service.getCharacteristic(this.platform.Characteristic.LockTargetState).updateValue(targetStateValue);
  }

  private restoreLockState(currentStateValue: number, targetStateValue: number) {
    this.setCachedCurrentState(currentStateValue);
    this.lastTargetStateValue = targetStateValue;
    this.updateLockCharacteristics(currentStateValue, targetStateValue);
  }

  private updateBatteryCharacteristics(currentBatteryLevelValue: number) {
    this.batteryService.getCharacteristic(this.platform.Characteristic.BatteryLevel).updateValue(currentBatteryLevelValue);
    this.batteryService.getCharacteristic(this.platform.Characteristic.StatusLowBattery)
      .updateValue(this.getLowBatteryValue(currentBatteryLevelValue));

    if (currentBatteryLevelValue < Number(this.platform.config.batteryLowLevel)) {
      this.platform.log.debug('Low battery level triggered');
    } else {
      this.platform.log.debug('Battery level is OK');
    }
  }

  private getLowBatteryValue(currentBatteryLevelValue: number): number {
    if (currentBatteryLevelValue < Number(this.platform.config.batteryLowLevel)) {
      return this.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
    }

    return this.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
  }

  private removeLegacyBatteryCharacteristics() {
    if (this.service.testCharacteristic(this.platform.Characteristic.BatteryLevel)) {
      this.service.removeCharacteristic(this.service.getCharacteristic(this.platform.Characteristic.BatteryLevel));
    }

    if (this.service.testCharacteristic(this.platform.Characteristic.StatusLowBattery)) {
      this.service.removeCharacteristic(this.service.getCharacteristic(this.platform.Characteristic.StatusLowBattery));
    }
  }

  private getStateCacheMs(): number {
    return this.getConfigNumber('stateCacheSeconds', 10, 0, 300) * 1000;
  }

  private getBatteryCacheMs(): number {
    return this.getConfigNumber('batteryCacheMinutes', 30, 1, 1440) * 60 * 1000;
  }

  private getApiTimeoutMs(): number {
    return this.getConfigNumber('apiTimeoutSeconds', 8, 1, 60) * 1000;
  }

  private getCommandTimeoutMs(): number {
    return this.getConfigNumber('commandTimeoutSeconds', 10, 1, 60) * 1000;
  }

  private getConfirmationDelayMs(): number {
    return this.getConfigNumber('commandConfirmDelaySeconds', 3, 0, 60) * 1000;
  }

  private getGatewayBusyBackoffMs(): number {
    return this.getConfigNumber('gatewayBusyBackoffSeconds', 15, 0, 300) * 1000;
  }

  private getGatewayBusyBackoffRemainingMs(): number {
    return Math.max(0, this.gatewayBusyBackoffUntil - new Date().getTime());
  }

  private getConfigNumber(key: string, defaultValue: number, min: number, max: number): number {
    const config = this.platform.config as Record<string, unknown>;
    const value = Number(config[key]);

    if (!Number.isFinite(value)) {
      return defaultValue;
    }

    return Math.max(min, Math.min(max, value));
  }
}
