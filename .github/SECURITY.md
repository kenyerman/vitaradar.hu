# Security policy

## Reporting a vulnerability

Please don't report security problems in public issues. E-mail **help@vitaradar.hu** with "Security" in the subject,
and include:

- what the problem is and where (page, address, request);
- how to reproduce it;
- what an attacker could do with it.

We will confirm that we got your report, keep you updated while we fix it, and credit you if you wish. There is no
bug bounty.

## Scope

- The website in this repository (vitaradar.hu).
- The services it talks to that we run: the user API, search, sign-in on auth.vitaradar.hu, cdn.vitaradar.hu, and
  the Firestore security rules. Their code is private, but reports about them are welcome here too.

Problems in Twitch, YouTube, Google, Firebase or GitHub themselves go to those companies.

## Testing in good faith

Use your own account. Don't read or change other people's data, don't degrade the service (no load or denial-of-service
tests, no spam), and stop and tell us as soon as you find something. We won't take action against good-faith research
that follows these rules.

## Supported versions

Only the live site (the `master` branch) is supported.
