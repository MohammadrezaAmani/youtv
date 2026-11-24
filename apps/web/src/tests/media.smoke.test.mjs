import test from "node:test";
import assert from "node:assert/strict";
import {
  srtToVtt,
  secondsToClock,
  makeTeletextUrl,
  isProbablyHls,
} from "../features/player/mediaUtils.ts";
test("SRT -> WebVTT: BOM, Windows lines and timestamp conversion", () => {
  const out = srtToVtt("\uFEFF1\r\n00:01:02,300 --> 00:01:03,700\r\nسلام");
  assert.match(out, /^WEBVTT\n\n/);
  assert.match(out, /00:01:02\.300 --> 00:01:03\.700/);
  assert.match(out, /سلام/);
});
test("duration formatting is stable", () => {
  assert.equal(secondsToClock(91), "1:31");
  assert.equal(secondsToClock(3671), "1:01:11");
});
test("Teletext requires HTTP(S), page template and 100..899", () => {
  assert.equal(
    makeTeletextUrl("https://example.org/teletext/{page}.txt", 100),
    "https://example.org/teletext/100.txt",
  );
  assert.throws(() => makeTeletextUrl("file:///tmp/{page}", 101));
  assert.throws(() => makeTeletextUrl("https://x/{page}", 99));
  assert.throws(() => makeTeletextUrl("https://x/page", 101));
});
test("explicit format hint identifies extensionless HLS", () => {
  assert.equal(isProbablyHls("https://host/stream?id=1", "hls"), true);
  assert.equal(isProbablyHls("https://host/stream.mp4", "auto"), false);
});
