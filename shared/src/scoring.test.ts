import { test } from "node:test";
import assert from "node:assert/strict";
import { teamScore, fileCountValid, type Challenge, type Submission } from "./index";

const challenge = (over: Partial<Challenge>): Challenge => ({
  challengeId: "c1",
  title: "t",
  description: "",
  active: true,
  type: "standard",
  proofType: "photo",
  points: 10,
  ...over,
});

const submission = (over: Partial<Submission>): Submission => ({
  teamId: "A",
  challengeId: "c1",
  files: [],
  submittedBy: "u",
  submittedAt: "2026-10-31T00:00:00Z",
  status: "submitted",
  ...over,
});

test("standard challenge awards its points", () => {
  assert.equal(teamScore("A", [submission({})], [challenge({})]), 10);
});

test("rejected submissions score nothing", () => {
  const subs = [submission({ status: "rejected" })];
  assert.equal(teamScore("A", subs, [challenge({})]), 0);
});

test("inactive challenges score nothing", () => {
  assert.equal(teamScore("A", [submission({})], [challenge({ active: false })]), 0);
});

test("a submission for an unknown challenge is ignored", () => {
  const subs = [submission({ challengeId: "gone" })];
  assert.equal(teamScore("A", subs, [challenge({})]), 0);
});

test("ranked challenges score only from placements, not submissions", () => {
  const ranked = challenge({
    challengeId: "r1",
    type: "ranked",
    points: undefined,
    awards: [{ place: 1, points: 50 }],
  });
  const subs = [submission({ challengeId: "r1" })];
  assert.equal(teamScore("A", subs, [ranked]), 0, "submitting alone scores nothing");

  ranked.placements = [{ place: 1, teamIds: ["A"] }];
  assert.equal(teamScore("A", subs, [ranked]), 50);
});

test("tied teams each take the full points for their place", () => {
  const ranked = challenge({
    challengeId: "r1",
    type: "ranked",
    points: undefined,
    awards: [
      { place: 1, points: 50 },
      { place: 2, points: 30 },
      { place: 3, points: 15 },
    ],
    // Two tied for first; the judge skips second by assigning third.
    placements: [
      { place: 1, teamIds: ["A", "B"] },
      { place: 3, teamIds: ["C"] },
    ],
  });
  assert.equal(teamScore("A", [], [ranked]), 50);
  assert.equal(teamScore("B", [], [ranked]), 50);
  assert.equal(teamScore("C", [], [ranked]), 15);
  assert.equal(teamScore("D", [], [ranked]), 0);
});

test("a placement with no matching award scores nothing", () => {
  const ranked = challenge({
    challengeId: "r1",
    type: "ranked",
    points: undefined,
    awards: [{ place: 1, points: 50 }],
    placements: [{ place: 2, teamIds: ["A"] }],
  });
  assert.equal(teamScore("A", [], [ranked]), 0);
});

test("standard and ranked points accumulate", () => {
  const std = challenge({ challengeId: "c1", points: 10 });
  const ranked = challenge({
    challengeId: "r1",
    type: "ranked",
    points: undefined,
    awards: [{ place: 1, points: 50 }],
    placements: [{ place: 1, teamIds: ["A"] }],
  });
  assert.equal(teamScore("A", [submission({})], [std, ranked]), 60);
});

test("proof type governs file count", () => {
  assert.ok(fileCountValid(challenge({ proofType: "none" }), 0));
  assert.ok(!fileCountValid(challenge({ proofType: "none" }), 1));
  assert.ok(fileCountValid(challenge({ proofType: "photo" }), 1));
  assert.ok(!fileCountValid(challenge({ proofType: "photo" }), 2));
  assert.ok(!fileCountValid(challenge({ proofType: "photos" }), 0));
  assert.ok(fileCountValid(challenge({ proofType: "photos", maxFiles: 3 }), 3));
  assert.ok(!fileCountValid(challenge({ proofType: "photos", maxFiles: 3 }), 4));
  assert.ok(fileCountValid(challenge({ proofType: "video" }), 1));
});
