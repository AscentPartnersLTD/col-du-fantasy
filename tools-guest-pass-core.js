/* GUEST PASSES. A guest signs in by LINK, never by email and code.
   =================================================================================

   A pass is one Firestore document, guestPasses/{passId}, and the passId IS the
   credential: it is in the URL Allen sends, and nothing else is required to sign in.
   That is the whole point of the change, and it carries two consequences worth stating
   before anything else reads this file:

   1. THE PASS ID IS A SECRET, so it is generated with crypto-grade randomness and is
      never derived from a label, a name or a date. 160 bits as 32 base32 characters,
      comfortably past the 128 the brief asks for. Guessing one is not a threat model
      anyone has to think about again.
   2. THE PASS ID IS ALSO A FIRESTORE DOCUMENT ID, so it has to survive that namespace:
      no slashes, no dots, not '.' or '..', under 1500 bytes. Lowercase base32 satisfies
      all of it and is also URL-safe with no escaping, which matters because this string
      is pasted into messages by a person.

   THE EMAIL IS SYNTHETIC AND IS NEVER A REAL ADDRESS. The whole auth stack is keyed by
   email: the session document, the custom token claim, firestore.rules `em()`, the
   `viewers` map and `userPools` are all addressed that way, and bending any of them to
   accept a non-email identity would mean touching the production path that four players
   sign in through. So a pass mints its own address under a domain that holds no
   mailboxes, and every one of those mechanisms keeps working unchanged.

   THAT DOMAIN MUST NEVER BE ABLE TO RECEIVE A SIGN-IN CODE. `guests.coldufantasy.com`
   has no mail, so a code sent there goes nowhere, but "goes nowhere" is a fact about DNS
   today and not a rule. `signsInByLinkOnly` is the rule, and both /auth/request and
   /auth/verify ask it, so the code path is closed by code rather than by configuration.
*/
/* THIS FILE EXISTS TWICE, and the two copies are asserted to agree.

   The board repo holds the source of truth at tools-guest-pass-core.js, where the owner
   tools that mint and revoke a pass can require it. The coldufantasy-login repo holds
   lib/guest-pass.js, which is what the Vercel functions import. They are separate repos
   with separate deploys and cannot share a file.

   A duplicated computation is what this project keeps paying for: FP_SCALE written out
   five times with two copies missed, the Kasseistampers tally counted twice, the
   Arlequin count rebuilt inside an IIFE. So the rule is not "do not duplicate", it is
   "duplicate and ASSERT": tools-guest-pass-parity.js fails if the region between the
   SHARED CORE markers below differs by one byte.

   The two wrappers around that region are the ONE legitimate difference: this repo is
   CommonJS, the other is an ESM package, and the crypto import spells differently.
   If parity fails, do NOT hand-edit either file to agree. Regenerate the copy. */

'use strict';

const crypto = require('node:crypto');

/* ---- SHARED CORE BEGIN. Byte-identical in both repos, asserted by
   tools-guest-pass-parity.js. Nothing above or below this pair is compared. ---- */

/* The domain is named ONCE. It appears in the email a pass mints, in the predicate that
   recognises one, and in the owner tools in the board repo, and those must agree
   exactly: a guest whose address does not match the predicate is treated as a PLAYER by
   isMember, which is the one failure here that would be silent and wrong in the
   dangerous direction. */
const GUEST_EMAIL_DOMAIN = 'guests.coldufantasy.com';

const GUEST_EMAIL_RE =
  new RegExp('^[a-z0-9][a-z0-9-]{0,40}@' + GUEST_EMAIL_DOMAIN.replace(/\./g, '\\.') + '$');

/* STRICT, and anchored at both ends. A loose test such as /guests\.coldufantasy\.com/
   would also match `real@person.com.guests.coldufantasy.com.evil.test`, and the whole
   access decision for a guest hangs off this answer. */
function isGuestEmail(email) {
  return GUEST_EMAIL_RE.test(String(email || '').trim().toLowerCase());
}

/* A guest never receives a code, whatever the roster says. See the header. */
function signsInByLinkOnly(email) {
  return isGuestEmail(email);
}

/* ---- the pass id ---------------------------------------------------------------- */

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';   // RFC 4648 lowercase, no padding

/* 32 characters of base32 is 160 bits. Rejection-free: 256 is a multiple of 32, so
   every random byte maps to exactly one character with no bias, which is why this does
   not use `% 36` over an alphabet that does not divide 256. */
function newPassId(bytes = 20) {
  const raw = crypto.randomBytes(bytes * 2);
  let out = '';
  for (let i = 0; i < raw.length && out.length < Math.ceil((bytes * 8) / 5); i++) {
    out += B32[raw[i] & 31];
  }
  return out;
}

/* A pass id arriving from a URL is UNTRUSTED. It is about to become a document path, so
   it is validated by SHAPE before any read, and a bad shape is refused without touching
   Firestore. This also keeps a caller from probing arbitrary document paths through the
   pass parameter. */
function looksLikePassId(id) {
  const s = String(id || '');
  return s.length >= 24 && s.length <= 64 && /^[a-z2-7]+$/.test(s);
}

/* ---- the synthetic email ------------------------------------------------------- */

/* The label is Allen's private name for the person. It is reduced to an ASCII slug so
   the address stays readable in a `viewers` map that he has to audit by eye, and
   truncated so one long label cannot push the local part past what the regex accepts.
   The RANDOM half is what makes it unique; the slug is only there to be legible, so a
   label that reduces to nothing is not an error. */
function syntheticEmail(label, passId) {
  const slug = String(label || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 12).replace(/-+$/, '');
  const tail = String(passId || '').slice(0, 10) || newPassId(8);
  const local = (slug ? slug + '-' : 'g-') + tail;
  return local + '@' + GUEST_EMAIL_DOMAIN;
}

/* ---- is this pass live? -------------------------------------------------------- */

/* ONE PREDICATE, and every caller uses it: /auth/guest at sign-in, isMember when a
   session is refreshed, and /api/guest-ping. Three sites answering this question three
   ways is how a revoked pass goes on working at one of them, which is the duplication
   this repo keeps recording.

   IT RETURNS A REASON, and the reason is for the SERVER LOG and the owner page, never
   for the caller. A guest who presents a missing, revoked or expired pass is told the
   same nothing in all three cases: a response that distinguished them would turn the
   endpoint into an oracle for which pass ids exist. */
function passState(data, nowMs) {
  const now = Number(nowMs || Date.now());
  if (!data) return { live: false, reason: 'missing' };
  if (data.revoked === true) return { live: false, reason: 'revoked' };
  const exp = toMillis(data.expires);
  if (exp === null) return { live: false, reason: 'no-expiry' };
  if (exp < now) return { live: false, reason: 'expired' };
  if (!isGuestEmail(data.email)) return { live: false, reason: 'bad-email' };
  return { live: true, reason: 'ok' };
}

/* `expires` is written as a Firestore Timestamp by the owner console snippet, and read
   back through the admin SDK as a Timestamp. It is ALSO accepted as a number or an ISO
   string, because a hand edit is the likeliest way this field ever gets written again,
   and a shape this function does not understand must deny rather than throw: an
   exception here would surface as a 500 on a sign-in attempt, which reads to a guest as
   "the site is broken" rather than "your link has lapsed".

   A string that does not parse returns null, which passState turns into a refusal. */
function toMillis(v) {
  if (v == null) return null;
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string') { const t = Date.parse(v); return isNaN(t) ? null : t; }
  if (typeof v.toMillis === 'function') { try { return v.toMillis(); } catch { return null; } }
  if (typeof v.toDate === 'function') { try { return v.toDate().getTime(); } catch { return null; } }
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  if (typeof v._seconds === 'number') return v._seconds * 1000;
  return null;
}

/* ---- what the visit log records about a device --------------------------------- */

/* DEVICE TYPE AND BROWSER ONLY, which is what the brief asks for and also as much as
   anyone needs to read a visit list. The full user-agent string is a fingerprint and a
   rough version history of somebody's phone, and storing it would make the visit log a
   worse thing to hold than it needs to be. The input is also attacker-controlled and
   unbounded, so it is never stored as given.

   The output is a short label, "iPhone / Safari". Unknown is reported as unknown rather
   than guessed, for the same reason the feed audit fails loudly: a wrong label that
   looks plausible is worse than an honest blank. */
function deviceSummary(ua) {
  const s = String(ua || '').slice(0, 512);
  if (!s) return 'unknown';

  let device = 'Desktop';
  if (/\biPad\b/i.test(s)) device = 'iPad';
  else if (/\biPhone\b/i.test(s)) device = 'iPhone';
  else if (/\biPod\b/i.test(s)) device = 'iPod';
  else if (/\bAndroid\b/i.test(s)) device = /\bMobile\b/i.test(s) ? 'Android phone' : 'Android tablet';
  else if (/\bWindows\b/i.test(s)) device = 'Windows';
  else if (/\bMac OS X\b|\bMacintosh\b/i.test(s)) device = 'Mac';
  else if (/\bCrOS\b/i.test(s)) device = 'Chromebook';
  else if (/\bLinux\b/i.test(s)) device = 'Linux';
  else device = 'unknown device';

  /* ORDER MATTERS AND IS THE WHOLE TRICK. Edge says Chrome and Safari, Chrome says
     Safari, and every iOS browser says Safari because they are all WebKit. So the most
     specific token has to be tested first, or everything reads as Safari. */
  let browser = 'unknown browser';
  if (/\bEdgi?A?O?S?\/|\bEdge\//i.test(s)) browser = 'Edge';
  else if (/\bOPR\/|\bOpera\//i.test(s)) browser = 'Opera';
  else if (/\bFxiOS\/|\bFirefox\//i.test(s)) browser = 'Firefox';
  else if (/\bCriOS\//i.test(s)) browser = 'Chrome';
  else if (/\bChrome\//i.test(s)) browser = 'Chrome';
  else if (/\bSafari\//i.test(s)) browser = 'Safari';

  return device + ' / ' + browser;
}

/* ---- what the visit log records about a board ---------------------------------- */

/* The board and the tab in view are the only things the ping takes from its REQUEST
   BODY, and the body is attacker-controlled, so both are reduced to a short, boring
   label before they are stored. Identity never comes from the body: that is the cookie's
   job, and it is the one rule of /api/guest-ping. */
function safeLabel(v, max = 40) {
  return String(v == null ? '' : v)
    .replace(/[^A-Za-z0-9 _.\-]/g, '')
    .trim()
    .slice(0, max);
}

/* ---- SHARED CORE END ---- */

module.exports = { GUEST_EMAIL_DOMAIN, isGuestEmail, signsInByLinkOnly, newPassId, looksLikePassId, syntheticEmail, passState, toMillis, deviceSummary, safeLabel };
