# Function reference

1. [The `window.Aura` bridge](#1-the-windowaura-bridge)
   - [Availability](#availability) · [Capabilities](#capabilities) · [Haptics](#haptics) · [Bluetooth LE](#bluetooth-le) · [iPhone-to-iPhone link (`Aura.peer`)](#iphone-to-iphone-link-aurapeer) · [Device identifiers](#device-identifiers) · [Proximity sensor](#proximity-sensor) · [Camera, microphone, location](#camera-microphone-location) · [Events](#events) · [Limits](#limits)
2. [How this page uses the link](#2-how-this-page-uses-the-link)
3. [Message protocol between the two iPhones](#3-message-protocol-between-the-two-iphones)
4. [The `AuraAll` bridge (Calculator and Notes iframes)](#4-the-auraall-bridge-calculator-and-notes-iframes)
5. [`AuraAtom` (Electricks Atom 2)](#5-auraatom-electricks-atom-2)
6. [`AuraPeekSmith` (Electricks PeekSmith 3)](#6-aurapeeksmith-electricks-peeksmith-3)

---

## 1. The `window.Aura` bridge

Aura Browser and the AuraClip App Clip inject `window.Aura` into web pages. Every call returns a **promise**; errors are rejected promises with a readable message.

### Availability

The bridge only answers pages that are:

- loaded over **HTTPS**, in the **main frame** (not in an iframe);
- in Aura Browser: on the domain of one of your **bookmarks** (subdomains included, `www.` ignored);
- in the App Clip: on the domain of the page the App Clip opened (or the domain it redirects to).

Any other page gets rejected promises. Each new page load disconnects Bluetooth devices, closes the iPhone link and stops proximity monitoring.

```js
if (window.Aura) {
  const caps = await Aura.capabilities();
}
```

### Capabilities

```js
const caps = await Aura.capabilities();
// { version: 1, appClip: true, haptics: true, customHaptics: true,
//   bluetooth: true, peer: true, proximity: true, deviceInfo: true }
```

| Field | Meaning |
| --- | --- |
| `version` | Bridge version. |
| `appClip` | `true` in the App Clip, `false` in Aura Browser. This page uses it to pick its role. |
| `haptics` / `customHaptics` | Haptics available / Core Haptics patterns supported by the hardware. |
| `bluetooth` | `Aura.bluetooth` available. |
| `peer` | `Aura.peer` (iPhone-to-iPhone link) available. |
| `proximity` | Proximity sensor present. |
| `deviceInfo` | `Aura.deviceInfo()` available. |

### Haptics

```js
Aura.haptic('impact', { style: 'heavy' });          // light | medium | heavy | soft | rigid
Aura.haptic('impact', { style: 'rigid', intensity: 0.4 });
Aura.haptic('notification', { style: 'success' });  // success | warning | error
Aura.haptic('selection');

// Custom pattern (Core Haptics). Times in seconds, intensity and sharpness from 0 to 1.
// duration 0 (or missing) = a short tap, duration > 0 = a continuous buzz.
Aura.haptic({ type: 'pattern', events: [
  { time: 0,    intensity: 1,  sharpness: 1 },
  { time: 0.15, intensity: 1,  sharpness: 1 },
  { time: 0.6,  duration: 0.4, intensity: 0.6, sharpness: 0.2 },
]});

// Call once early (e.g. on the first touch) to remove the small first-time latency.
Aura.prepareHaptics();
```

`navigator.vibrate()` also works in Aura (it does nothing in Safari on iPhone):

```js
navigator.vibrate([100, 50, 100]);   // buzz 100 ms, pause 50 ms, buzz 100 ms
```

### Bluetooth LE

UUIDs are 16-bit hex strings (`'180D'`) or full UUIDs. Data you write can be a string (sent as UTF-8), an array of bytes, an `ArrayBuffer` or a typed array. Values you read arrive as a `DataView`.

| Function | Returns |
| --- | --- |
| `Aura.bluetooth.state()` | `'poweredOn'`, `'poweredOff'`, `'unauthorized'`, `'unsupported'`, `'resetting'` or `'unknown'`. |
| `Aura.bluetooth.requestDevice({ services, name, namePrefix, timeout })` | First matching device: `{ id, name, rssi }`. Scans until a match, `timeout` in seconds (10 by default). |
| `Aura.bluetooth.scan({ services, name, namePrefix })` | Starts a continuous scan; results arrive as `bluetooth.discovered` events. |
| `Aura.bluetooth.stopScan()` | Stops the scan. |
| `Aura.bluetooth.connect(id, { timeout })` | `{ id, name, services: [{ uuid, characteristics: [{ uuid, properties }] }] }`. |
| `Aura.bluetooth.disconnect(id)` | — |
| `Aura.bluetooth.read(id, service, characteristic)` | `DataView`. |
| `Aura.bluetooth.write(id, service, characteristic, data, { withoutResponse })` | — |
| `Aura.bluetooth.startNotifications(id, service, characteristic)` | Values then arrive as `bluetooth.notification` events. |
| `Aura.bluetooth.stopNotifications(id, service, characteristic)` | — |

```js
const device = await Aura.bluetooth.requestDevice({ services: ['180D'], namePrefix: 'Polar' });
await Aura.bluetooth.connect(device.id);

Aura.on('bluetooth.notification', ({ id, service, characteristic, value }) => {
  console.log('Heart rate', value.getUint8(1));
});
await Aura.bluetooth.startNotifications(device.id, '180D', '2A37');

const battery = await Aura.bluetooth.read(device.id, '180F', '2A19');
console.log('Battery', battery.getUint8(0), '%');

await Aura.bluetooth.write(device.id, 'FFE0', 'FFE1', 'hello');
await Aura.bluetooth.write(device.id, 'FFE0', 'FFE1', [0x01, 0x02], { withoutResponse: true });
await Aura.bluetooth.disconnect(device.id);
```

Events: `bluetooth.discovered` (`{ id, name, rssi }`), `bluetooth.notification` (`{ id, service, characteristic, value }`), `bluetooth.state` (`{ state }`), `bluetooth.disconnected` (`{ id }`).

Notes:

- The first Bluetooth call shows the iOS permission prompt.
- Bluetooth only works while the page is on screen.
- This page only calls `Aura.bluetooth.state()` when the Bluetooth screen opens, so that a second Bluetooth manager does not start while the two iPhones are pairing.

### iPhone-to-iPhone link (`Aura.peer`)

Connects two iPhones running Aura directly over Bluetooth LE and sends data both ways. One side **hosts**, the other **joins**. Either side can host; hosting from Aura Browser is easier, because it is ready before the tag is scanned.

| Function | Returns |
| --- | --- |
| `Aura.peer.host({ room, name })` | `{ room, role: 'host' }` once the iPhone is advertising. |
| `Aura.peer.join({ room, name, timeout })` | The host: `{ id, name, room, role: 'guest' }`. Scans for `timeout` seconds (30 by default), then rejects with *“no device is hosting this room nearby”*. |
| `Aura.peer.send(data, { to })` | Resolves once the message is handed to Bluetooth. `to` (host only): one guest id instead of all guests. |
| `Aura.peer.peers()` | `[{ id, name }]`. |
| `Aura.peer.leave()` | Closes the link (no event on this side; the other side gets `peer.disconnected`). |

**Automatic pairing (no `room`).** In the App Clip, the room is the Aura link that opened it; in Aura Browser, the rooms are the owner's own links (main link and extra links). A spectator's App Clip therefore only connects to the browser of the person whose tag was scanned, even with several Aura users nearby. The link identifier is never broadcast, only a one-way hash. Without `room`, `host()` / `join()` reject in an App Clip that was not opened from an Aura link.

**Named room.** Pass the same `room` on both sides (case-insensitive, 64 characters max) to pair any two Aura pages: two browsers, two App Clips, etc. The room name becomes a private Bluetooth service ID.

```js
// Aura Browser (owner's iPhone): waits for the App Clip
await Aura.peer.host({ name: 'Performer' });

// App Clip (second iPhone): finds the owner
const host = await Aura.peer.join({ name: 'Spectator', timeout: 15 });

// Both sides
Aura.on('peer.connected', ({ id, name }) => console.log(name, 'joined'));
Aura.on('peer.message', ({ from, kind, data }) => console.log(kind, data));
Aura.on('peer.disconnected', ({ id }) => console.log(id, 'left'));

await Aura.peer.send('hello');                    // kind 'text'   → data is a string
await Aura.peer.send({ card: 'AS', x: 0.4 });     // kind 'json'   → data is the parsed object
await Aura.peer.send(new Uint8Array([1, 2, 3]));  // kind 'binary' → data is a DataView
```

Notes:

- `peer.connected` fires on the host when a guest joins, and on the guest just before `join()` resolves.
- A host can accept several guests; a guest only talks to its host.
- Messages up to **64 KB**, delivered in order. Expect a few KB/s: fine for commands and small JSON, not for big images.
- Navigating to another page, locking the phone or calling `leave()` closes the link.

### Device identifiers

```js
const { userId, vendorId, model, systemName, systemVersion, appClip } = await Aura.deviceInfo();
```

- `userId`: the Aura identifier (the one written on NFC tags). In Aura Browser it lives in the iCloud Keychain, so it survives reinstalls and is shared by your devices. In the App Clip it is the identifier of the scanned tag or link (`null` if none).
- `vendorId`: iOS `identifierForVendor`, specific to this device.

### Proximity sensor

```js
Aura.on('proximity', ({ near }) => console.log(near ? 'covered' : 'uncovered'));
const { supported, near } = await Aura.proximity.start();
await Aura.proximity.stop();
```

While monitoring is on, iOS turns the screen off when the sensor is covered (like during a call).

### Camera, microphone, location

Use the standard web APIs; Aura adds the iOS permissions they need:

```js
const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: true });
await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: true }] });   // flash (back camera)
navigator.geolocation.getCurrentPosition((pos) => console.log(pos.coords));
```

On trusted pages Aura skips the extra WebKit camera/microphone prompt; iOS still asks for the system permission once. In the App Clip, location access is limited by iOS and expires automatically.

### Events

```js
const off = Aura.on('proximity', handler);   // returns a function that removes the listener
Aura.off('proximity', handler);              // same thing
window.addEventListener('aura:proximity', (e) => console.log(e.detail.near));   // every event is also a window event
```

| Event | Detail |
| --- | --- |
| `peer.connected` | `{ id, name }` |
| `peer.message` | `{ from, kind, data }` |
| `peer.disconnected` | `{ id }` |
| `bluetooth.discovered` | `{ id, name, rssi }` |
| `bluetooth.notification` | `{ id, service, characteristic, value }` |
| `bluetooth.state` | `{ state }` |
| `bluetooth.disconnected` | `{ id }` |
| `proximity` | `{ near }` |

### Limits

- Motion sensors (accelerometer, gyroscope) are not exposed: Apple blocks Core Motion in App Clips.
- The bridge does not answer iframes. This is why the Calculator and Notes iframes go through the parent page (see [section 4](#4-the-auraall-bridge-calculator-and-notes-iframes)).

---

## 2. How this page uses the link

`app.js` opens **one** `Aura.peer` link for the whole page:

1. `Aura.capabilities()` gives the role: **host** in Aura Browser, **guest** in the App Clip (or `?role=`).
2. The host calls `Aura.peer.host({ room })` and retries every 3 s on error (Bluetooth off, permission prompt still open…).
3. The guest calls `Aura.peer.join({ room, timeout: 15 })` in a loop until it finds the host, and starts again whenever the link drops.
4. Once connected, the guest sends `sync.req`; the host answers with its state (current screen, calculator, drawing). The guest also sends its own drawing, so nothing is lost.
5. Navigation uses `#hash` (`#calc`, `#draw`, `#cards`…), so the page and the link are never reloaded.

`room` comes from `?room=`, or from the room code entered on the home screen (kept in `localStorage`), or is empty for automatic pairing. Each step is written to the link log on the Device screen.

## 3. Message protocol between the two iPhones

Every message is a JSON object sent with `Aura.peer.send()`, with its type in `t`.

| `t` | Fields | Sent by | Effect |
| --- | --- | --- | --- |
| `sync.req` | — | guest, after connecting | Host sends its state back. |
| `nav` | `v`: screen (`home`, `calc`, `draw`, `cards`, …) | host (when “follows my screens” is on) | Guest opens the same screen. |
| `calc.state` | `k`: key, `s`: `{ terms, entry, result, lastExpression }`, `forced` | both | Other calculator shows the same state and animates the key. |
| `calc.force` | `force`: `{ on, type, digits }` | host | Force settings, applied on whichever iPhone presses `=`. |
| `calc.sync` | `s`, `force` | host | Full calculator state after connecting. |
| `n.live` | `id`, `h` (first message: tool, color, opacity, width), `p`: points | both | Stroke being drawn, sent every 50 ms. |
| `n.ops` | `rm`: ids, `add`: `[{ id, after, item }]` | both | Drawing changes: removed items, added items (inserted after `after`). Split into ≤ 40 KB messages. |
| `card` | `card`: e.g. `'Q♥'` | both | Card shown with a buzz. |
| `msg` | `text` | both | Chat message. |
| `reveal` | `text` | both | Full-screen text. |
| `buzz` / `flash` | — | both | Haptic pattern / screen flash. |
| `ping` / `pong` | `id` | both | Round-trip time. |
| `haptic` | `a` (arguments of `Aura.haptic`), or `p` (pattern events), or `v` (`navigator.vibrate` pattern) | both | Plays the haptic on the receiver. |
| `prox` | `near` | both | Proximity sensor state of the sender. |
| `photo` | `src`: JPEG data URL (≈ 240 px, < 48 KB) | both | Photo thumbnail. |

**Coordinates in Notes** travel as integers from 0 to 10000, as a fraction of the screen **width** for both x and y. A drawing therefore keeps its proportions on two screens of different sizes; only the bottom can be cut on the shorter screen.

## 4. The `AuraAll` bridge (Calculator and Notes iframes)

`calc/index.html` and `notes/index.html` run in full-screen iframes, so they cannot use `window.Aura`. The parent page exposes `window.AuraAll` and relays their messages over the link.

**Parent → iframe** (`window.parent.AuraAll`):

| Member | Description |
| --- | --- |
| `isHost()` | `true` on the performer's side. |
| `connected()` | `true` while the other iPhone is connected. |
| `send(message)` | Sends a JSON message (`{ t: 'calc.…' }` or `{ t: 'n.…' }`) to the other iPhone. |
| `haptic(...args)` | Same arguments as `Aura.haptic()`. |
| `relay(text)` | Shows a short text on the PeekSmith / buzzes the Atom, if connected and enabled. |
| `back()` | Back to the home screen. |

**Iframe → parent** (functions the iframe defines on its own `window`):

| Function | Called |
| --- | --- |
| `auraIncoming(message)` | For each message of the iframe's types received from the other iPhone (`calc.*` → calculator, `n.*` → Notes). |
| `auraSync()` | When the link connects: send the full state. |
| `auraRefresh()` | When the screen is shown. |

The parent also passes the iPhone safe areas as CSS variables `--safe-top` and `--safe-bottom` on the iframe's `<html>` element, because `env(safe-area-inset-*)` is 0 inside an iframe.

Both iframes also work on their own (opened directly, without the parent page).

## 5. `AuraAtom` (Electricks Atom 2)

`aura-atom.js` drives an Atom 2 over `Aura.bluetooth`. Protocol: [Electricks developer docs](https://developers.electricks.info/docs/bluetooth/devices/atom-2).

```js
const atom = await AuraAtom.connect({ timeout: 15 });   // finds the first "Atom-2…" nearby and connects
atom.on('click', ({ button }) => console.log('button', button));
await atom.vibrate('..');
await atom.led('g', { blink: true });
```

| Member | Description |
| --- | --- |
| `AuraAtom.isAvailable()` | `true` if `window.Aura.bluetooth` is available. |
| `AuraAtom.connect(options)` / `new AuraAtom(options).connect()` | Options: `timeout` (s, 15), `name` (exact name), `autoReconnect` (`true`), `lang` (`'fr'` / `'en'`). |
| `disconnect()` | — |
| `vibrate(pattern = '.')` | Vibration pattern (`.` short, `-` long; see the Electricks docs for the full syntax). |
| `led(color, { blink })` | `r g b y o p w c`, or `null` to turn it off. |
| `configureButtons({ click, longPress, repeatDelay, repeatInterval })` | Button timings in ms. |
| `battery()` / `isCharging()` / `firmware()` | Device queries. |
| `runScript(code)` | Uploads and compiles a MagiScript program. |
| `send(command)` / `query(command, prefix, timeout)` | Raw text commands. |
| `on(event, callback)` / `off(event, callback)` | `on()` returns an unsubscribe function. |

Events: `button` (all), `press`, `release`, `click`, `multiclick`, `click2`, `click3`…, `longpress`, `repeatpress`, `line`, `status` (`{ state: 'scanning' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' }`), `connect`, `disconnect`.

## 6. `AuraPeekSmith` (Electricks PeekSmith 3)

`aura-peeksmith.js` drives a PeekSmith 3 over `Aura.bluetooth`. It handles the device's constraints: name-based search, 1.5 s wait after connecting, 19-byte packets 200 ms apart. Protocol: [Electricks developer docs](https://developers.electricks.info/docs/bluetooth/devices/peeksmith-3).

```js
const ps = await AuraPeekSmith.connect();
await ps.text('Q♥');
ps.on('click', ({ button }) => console.log(button));   // 0 side, 1 left, 2 right
```

| Member | Description |
| --- | --- |
| `AuraPeekSmith.isAvailable()` / `AuraPeekSmith.connect(options)` | Same options as `AuraAtom`. |
| `disconnect()` / `powerOff()` | — |
| `text(value, { raw })` | Shows text (`\n` for a new line). Card codes like `AH` are drawn as cards unless `raw: true`. |
| `clear()` | Clears the screen. |
| `brightness(level)`, `font(code)`, `textColor(color)`, `backgroundColor(color)`, `align('left' \| 'center' \| 'right')`, `rotate(upsideDown)`, `mirror(on)` | Display settings. |
| `vibrate(pattern = '.')` | Vibration pattern. |
| `battery()` (%), `batteryVoltage()`, `isCharging()`, `firmware()` | Device queries. |
| `subscribeTaps(on)`, `subscribeMovement(on)` | Enables `tap` / `move` events. |
| `send(command)` / `query(command, prefix, timeout)` | Raw text commands. |
| `on(event, callback)` / `off(event, callback)` | `on()` returns an unsubscribe function. |

Events: `button`, `press`, `release`, `click`, `longpress`, `tap` (`{ count }`), `move`, `vibrationEnd`, `charging` (`{ charging }`), `line`, `status`, `connect`, `disconnect`.
