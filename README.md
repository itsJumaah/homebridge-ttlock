
<span align="center">

<p align="center">
<img src="https://raw.githubusercontent.com/homebridge/branding/master/logos/homebridge-color-round-stylized.png" width="150">
</p>

<p align="center">
<img src="https://open.ttlock.com/resources/developer/img/logo_ttlock.a53b544e.png" width="80">
</p>




# Homebridge TTLock v2026 Plugin



<p>A Homebridge <a href="https://open.ttlock.com/document/doc?urlName=userGuide%2FekeyEn.html">TTLock</a>  
plugin that allows you to access your TTLock Device(s) from HomeKit with
  <a href="https://homebridge.io">Homebridge</a>. 
</p>

[![github checks](https://badgen.net/github/checks/itsJumaah/homebridge-ttlock-v2026?icon=github&label=checks)](https://github.com/itsJumaah/homebridge-ttlock-v2026)
[![github release](https://badgen.net/github/release/itsJumaah/homebridge-ttlock-v2026?icon=github&label=release)](https://github.com/itsJumaah/homebridge-ttlock-v2026)
[![npm version](https://badgen.net/npm/v/homebridge-ttlock-v2026?icon=npm&label=version)](https://www.npmjs.com/package/homebridge-ttlock-v2026)
[![npm downloads](https://badgen.net/npm/dt/homebridge-ttlock-v2026?icon=npm&label=downloads)](https://www.npmjs.com/package/homebridge-ttlock-v2026)


</span>


# Requirements
1. Lock/door handle using TTLock Platform (Wifi, or Bluetooth + Gateway)
2. If using Bluetooth - TTLock Compatible Gateway (G1, G2, G3, or G4). Successfully tested with [this one](https://www.amazon.com/gp/product/B085THR6VX)
3. TTLock app for iOS or Android 
4. Bash access to run curl command
<br><br><br>


# Setup Instructions

## Create TTLock Developer Account
1. Go to [TTLock Platform Registration](https://open.ttlock.com/register).
2. Complete the required information to create a developer account for API access.
3. Wait for the email confirming activation of your account (manual process that will be completed by TTLock).
4. Log back into the TTLock Developer Platform and retreive your ClientId and ClientSecret.

<br><br>

## Create a New User on Developer Account

1. Make up a new username. Creating a new user account is required! It must be associated with your developer account (unfortunately you can't use an account you've already set up on the TTLock app).
2. Come up with a password and save it somewhere. When you submit the request to create the new user, you'll have to submit the password as md5 (use [this site](https://www.md5online.org/md5-encrypt.html)).
3. Using a terminal, run this command to create the new user on your developer account:

```
curl --location --request POST 'https://euapi.ttlock.com/v3/user/register?clientId=[clientid]&clientSecret=[clientsecret]&username=[username]&password=[passwordasmd5]&date=CURRENTMILLIS' \
--header 'Content-Type: application/x-www-form-urlencoded' \
```
4. In the response to the request, note the username that is assigned (it will be your username prefixed with some random characters).  This will be the username you'll use to log into the mobile app and the Homebridge plugin from now on.


<br><br>


## Associate Lock and Gateway with New Account

1. Log into the TTLock iOS or Android app with your new account.  You'll use the username that the API call returned, and the password you created (NOT as md5).
2. Add your lock(s) to the app to accociate them with your account.  If you have previously used the lock with the app, you'll have to reset and add it to the new account.
3. If using Bluetooth, add the gateway (and ensure it is associated with the locks).
4. **Important** -In the settings for each lock, ensure the Remote Unlock setting is set to On.

<br><br>

## Plugin Installation
**Recommended**: install via the Homebridge UI

Or install the plugin with the following command:
```
npm install -g homebridge-ttlock-v2026
```
<br><br>

## Migration from other TTLock packages

If you are moving from `homebridge-ttlock` or `homebridge-ttlock-improved`, uninstall the old package first so Homebridge
does not load two plugins with the same `ttlock` platform alias. Your Homebridge config can keep `"platform": "ttlock"`.

<br><br>

## Configuration
```
        {
            "platform": "ttlock"
            "name": "TTLock Platform",
            "clientid": "clientid",
            "clientsecret": "clientsecret",
            "username": "username",
            "password": "passwordasmd5",
            "batteryLowLevel": 15,
            "maximumApiRetry": 5;
        }
```

**name**: Platform display name

**clientid**: Your ClientId from the TTLock developer platform.

**clientsecret**: Your ClientSecret from the TTLock developer platform.

**username**: Username for the user account accociated with the developer account.

**password**: Password for the user account as md5.

**batteryLowLevel**: The battery level percentage at which a low battery warning will be displayed in the HomeKit status.

**maximumApiRetry**: Maximum times to retry hitting the API.

**stateCacheSeconds**: How long to reuse the last lock state before calling TTLock again.

**batteryCacheMinutes**: How long to reuse the last battery level before calling TTLock again.

**apiTimeoutSeconds**: Timeout for TTLock state, battery, token, and discovery API calls.

**commandTimeoutSeconds**: Timeout for TTLock lock and unlock commands.

**commandConfirmDelaySeconds**: How long to wait after a successful lock/unlock command before confirming the real lock state.

**gatewayBusyBackoffSeconds**: How long to pause lock/unlock commands after TTLock reports the gateway is busy.

<br><br>

# Usage

* On Homebridge load, plugin will get all locks from TTLock account and add them to Homebridge (if they are not already cached)
* Use Homekit to lock and unlock your locks!
* Homekit will show the lock battery through a dedicated Battery service and warn when the lock has low battery

<br><br>
