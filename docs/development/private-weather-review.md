# Standalone native private weather review

This is not the ordinary game scene. It is never loaded by `main.tscn`; no default launch, HTTP route, public UI or account configuration changes are included.

After a separately authorized disposable signed-weather fixture prints its loopback port, world ID and entry ID, launch:

```
godot --path godot-client res://private_weather_review.tscn -- --weather-review-port=PORT --weather-review-world=WORLD --weather-review-entry=ENTRY
```

Only literal IPv4 loopback is used, with no redirects. The native-only viewer validates the exact DTO, explicit world/entry pins, bounded versions, 1–24 unique weather facts and their numerical/enum ranges. It renders no server-provided prose. Requests are single-flight, every 2 seconds, timeout 2 seconds, body at most 64 KiB. Failure/unavailability/mismatch clears the text; accepted views expire after 3 seconds without a fresh successful response. Version rollback or changed content at unchanged versions is rejected. The window exits after 5 minutes. Closing the window does not own or stop the fixture server; the operator must also stop that server and verify cleanup.

The view does not independently verify cryptographic signatures. That authority remains with the separately reviewed backend. Its pins prevent accidentally rendering another world/entry; they are not authentication of an arbitrary process bound to the same local port.

Short local validation: Godot 4.6.3 headless parser cases (valid fact, foreign world, foreign entry, unknown property, out-of-range value, duplicate fact) and explicit scene boot. Actual native rendering verified using a disposable independently signed synthetic edition with one weather fact. No real model or user save was used. Disconnect/timeout/rollback branches are implemented but not claimed as end-to-end fault-injection tested.

The regular Web export excludes the native review scene and script.
