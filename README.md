# Aura · All demos

One web page that shows everything a page can do inside **Aura Browser** and the **AuraClip App Clip** on iPhone, including a direct **Bluetooth link between two iPhones** (no Wi-Fi, no internet, no server).

Open the same page on two iPhones:

| iPhone | Opened in | Role |
| --- | --- | --- |
| Yours (performer) | Aura Browser | **Host**: waits for the other iPhone |
| Spectator's | AuraClip App Clip, by scanning your Aura tag or link | **Guest**: finds your iPhone and connects by itself |

The two iPhones pair automatically through your App Clip link, and reconnect by themselves if the link drops. Switching between demos never reloads the page, so the link stays open the whole time.

The page is in **French and English**. It follows the phone language; you can change it with the **Français / English** switch at the bottom of the home screen, or with `?lang=fr` / `?lang=en`.

## Demos

| Demo | What it does |
| --- | --- |
| 🧮 **Calculator** | An iPhone-style calculator, full screen, mirrored key by key on both iPhones. On the performer's side, the top-right button opens **Settings**: **force** the result (last digits with `X` wildcards, whole number, current date and time, today's date), see every key typed on the other iPhone, buzz on every key. |
| ✏️ **Notes** | An iPhone Notes-style drawing canvas (pen, fineliner, highlighter, eraser, lasso, colors, text, images). Each stroke appears on the other iPhone **while it is being drawn**, in both directions. Erasing, moving, undo and clear are synced too; undo only removes your own strokes. Drawings keep their proportions across screen sizes. |
| 🃏 **Card** | Pick one of the 52 cards; it appears on the other iPhone with a buzz (and on a PeekSmith if connected). |
| 💬 **Messages** | Chat, make the other iPhone buzz, flash its screen, measure the round trip, or **reveal a text full screen** on the other iPhone. |
| 📳 **Haptics** | Every iOS haptic, Core Haptics patterns, `navigator.vibrate`, and a **Morse code** sender. Everything can be played on the other iPhone instead. |
| 📷 **Sensors** | Proximity sensor (with an alert on the other iPhone), camera (front/back, torch, photo sent as a thumbnail), microphone level (a clap buzzes the other iPhone), GPS location. |
| 🔵 **Bluetooth** | Scan nearby Bluetooth LE devices; drive an **Electricks Atom 2** and a **PeekSmith 3** (cards, results and messages received are shown on the PeekSmith). |
| ℹ️ **Device** | Aura capabilities, device identifiers, link state and a timestamped **link log**, reconnect / cut the link. |

On the host's home screen, **“The other iPhone follows my screens”** makes the App Clip switch demo at the same time as you.

## Requirements

- An iPhone with **Aura Browser**, and the **AuraClip** App Clip opened from your Aura tag or link on the second iPhone.
- The page must be served over **HTTPS**, on a domain that is in your **Aura bookmarks** (in the App Clip: the domain of the page the App Clip opened). Aura only gives native features (`window.Aura`) to those pages, in the main frame.
- Both screens must stay on: locking a phone or leaving the page closes the Bluetooth link.

## Getting started

1. Host the contents of this repository on any HTTPS static host (GitHub Pages works).
2. In Aura Browser, add the page's domain to your bookmarks, then open the page.
3. Set the same URL as the destination of your Aura App Clip link (or open it from the App Clip).
4. Scan your tag with the second iPhone: the App Clip opens the page and connects.

If automatic pairing does not work, open **“Not connecting?”** on the home screen and enter the same room code on both iPhones. The **Device** screen logs each step of the link with its exact error.

### URL options

| Option | Effect |
| --- | --- |
| `?room=abc` | Named room (same value on both iPhones) instead of automatic pairing through the App Clip link. Also settable from the home screen. |
| `?role=host` / `?role=join` | Force the role, e.g. two Aura Browsers: `?room=abc&role=host` on one, `?room=abc&role=join` on the other. |
| `?lang=fr` / `?lang=en` | Language. |
| `?mock=host` / `?mock=join` | Desktop simulator, see below. |

## Testing on a computer

`aura-mock.js` simulates `window.Aura` in a desktop browser, with the iPhone link carried over `BroadcastChannel`. It is only loaded when the URL contains `?mock=`, never inside Aura.

```bash
python3 -m http.server 8769
```

Then open two tabs of the same browser:

- `http://localhost:8769/?mock=host` (Aura Browser side)
- `http://localhost:8769/?mock=join` (App Clip side)

Calculator, Notes, cards, messages, haptics (logged to the console), navigation and room codes all work between the two tabs. Bluetooth devices, the proximity sensor and real haptics need an iPhone.

## Project structure

```
index.html          Home screen and every demo except Calculator and Notes
app.js              Page logic: Bluetooth link, navigation, demos, relay to the iframes
style.css           Page styles
i18n.js             French / English
calc/index.html     iPhone-style calculator (full-screen iframe)
notes/              iPhone Notes-style drawing (full-screen iframe)
aura-atom.js        Electricks Atom 2 library (over window.Aura.bluetooth)
aura-peeksmith.js   Electricks PeekSmith 3 library (over window.Aura.bluetooth)
aura-mock.js        Desktop simulator of window.Aura (only with ?mock=)
docs/API.md         Function reference
```

## Documentation

**[docs/API.md](docs/API.md)** documents every function used by the page:

- the `window.Aura` bridge (haptics, Bluetooth LE, iPhone-to-iPhone link, proximity, device identifiers, events);
- the message protocol between the two iPhones;
- the `AuraAll` bridge used by the Calculator and Notes iframes;
- the `AuraAtom` and `AuraPeekSmith` libraries.
