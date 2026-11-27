---
paths:
  - "home-assistant-voice-firmware/**"
---

# Usage

> Part of [Home Assistant Voice Firmware](home-assistant-voice-firmware.md). Paths in it are relative to `home-assistant-voice-firmware/` unless they say otherwise.

Every firmware target goes through Turbo. Flashing needs real WiFi credentials, so the
targets that flash resolve them from 1Password themselves.

| Target | What it does | Exits? |
| --- | --- | --- |
| `build` | Compile with placeholder credentials; cannot be flashed | yes |
| `serve` | `esphome run`: compile, flash, then follow the logs | no — holds the serial port |
| `upload` | Compile with real credentials and flash once | yes |
| `wake-word-test` | The acoustic end-to-end test (see [Acoustic End-to-End Test](home-assistant-voice-firmware-acoustic-e2e.md)) | yes |

`serve` and `upload` flash over the network by default. Set `ESPHOME_DEVICE=/dev/ttyACM0`
to flash over USB instead.

There is deliberately **no firmware `deploy` target**. The `Release` workflow runs
`bunx turbo deploy` across the whole workspace in CI, so a firmware `deploy` would try to
flash a device that CI does not have. Use `upload` to put a build on the device.

```bash
bunx turbo build --filter=home-assistant-voice-firmware
ESPHOME_DEVICE=/dev/ttyACM0 bunx turbo upload --filter=home-assistant-voice-firmware
```

## USB under WSL

WSL only sees a USB device that Windows forwards to it. Windows has to see the Voice PE
first: `usbipd.exe list` (runnable from WSL) must show `303a:1001  USB JTAG/serial debug
unit`. If it does not appear at all, the cable or port is the problem, not WSL. A
charge-only cable shows nothing, and a flaky one leaves an "unknown USB device
(descriptor request failed)" entry behind.

Once Windows sees it:

```bash
# Once per device, elevated (raises a UAC prompt on Windows)
powershell.exe -NoProfile -Command "Start-Process usbipd -ArgumentList 'bind','--busid','<BUSID>' -Verb RunAs -Wait"
# Every session; --auto-attach re-attaches after the resets that flashing causes
usbipd.exe attach --wsl --busid <BUSID> --auto-attach
```

Without `--auto-attach`, the first reset (esptool, or a reboot after flashing) detaches
the device and `/dev/ttyACM0` disappears.

`upload` over USB can still fail under WSL with `No serial data received` or
`Could not configure port: (5, 'Input/output error')`. The compile succeeds; only the
flash fails. esptool resets the S3 into its ROM bootloader, the chip drops off USB for a
moment, and the forwarded port goes with it. Flash in two steps instead, so the dropout
happens before esptool connects:

1. Put the chip in download mode with esptool's USB-Serial-JTAG line sequence (RTS/DTR
   low; DTR high; RTS high with DTR low; both low), sent from pyserial. The serial
   output ends in `boot:0x0 (DOWNLOAD(USB/UART0))` and `waiting for download`.
2. Wait for `/dev/ttyACM0` to come back, then flash the image `upload` already built,
   without letting esptool reset the chip:
   `esptool --before no-reset --after no-reset --port /dev/ttyACM0 --chip esp32s3 write-flash -z 0x0 .esphome/build/hass-elevenlabs/build/firmware.factory.bin`
3. Pulse RTS with DTR low to boot the new firmware.

If the app logs nothing over serial after the bootloader lines, the device is running a
build whose logger is not on USB. Flash a current build with `upload`.

If a compile fails with `PermissionError` on `.esphome/build`, an old Docker build left
that directory owned by root. Move it aside; ESPHome rebuilds it.
