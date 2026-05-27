
import { DeviceConfiguration } from './device-configuration';

/**
 * Represents the homebridge configuration for the plugin.
 */
export interface Configuration {

    /**
     * Gets or sets the URI for the token endpoint.
     */
    tokenUri: string;

    /**
     * Gets or sets the number of retries before repoorting failure.
     */
    maximumTokenRetry: number;

    /**
     * Gets or sets the interval between retries in milliseconds.
     */
    tokenRetryInterval: number;

    /**
     * Gets or sets the URI of the HTTP API.
     */
    apiUri: string;

    /**
     * Gets or sets the number of retries before repoorting failure.
     */
    maximumApiRetry: number;

    /**
     * Gets or sets the cache duration for lock state reads in seconds.
     */
    stateCacheSeconds?: number;

    /**
     * Gets or sets the cache duration for battery reads in minutes.
     */
    batteryCacheMinutes?: number;

    /**
     * Gets or sets the timeout for TTLock read/token API calls in seconds.
     */
    apiTimeoutSeconds?: number;

    /**
     * Gets or sets the timeout for TTLock lock/unlock commands in seconds.
     */
    commandTimeoutSeconds?: number;

    /**
     * Gets or sets the delay before confirming lock state after a command in seconds.
     */
    commandConfirmDelaySeconds?: number;

    /**
     * Gets or sets the gateway busy backoff duration in seconds.
     */
    gatewayBusyBackoffSeconds?: number;

    /**
     * Gets or sets the interval between retries in milliseconds.
     */
    apiRetryInterval: number;

    /**
     * Gets or sets the email address of the Tedee account.
     */
    emailAddress: string;

    /**
     * Gets or sets the password of the Tedee account.
     */
    password: string;

    /**
     * Gets or sets the devices that should be exposed to HomeKit.
     */
    devices: Array<DeviceConfiguration>;

    /**
     * Gets or sets the update interval for device data in seconds.
     */
    updateInterval: number;
}
