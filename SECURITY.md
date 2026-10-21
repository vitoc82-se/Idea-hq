# Security

Idea HQ is built and run by one person. Security reports are welcome and taken seriously.

## Reporting a vulnerability

Please report it **privately**, not in a public issue or pull request:

1. Open the **Security** tab of this repository.
2. Choose **Report a vulnerability** and describe what you found and how to reproduce it.

Please include the address or feature involved, the steps, and what an attacker could do. Do not test against other people's accounts or data, and do not run anything that could take the site down or read other people's information.

I will acknowledge a report within a few days, keep you updated, and tell you when it is fixed. This is a solo project, so these are best-effort times, not promises.

## What is in scope

The running service at https://ideahq.cloud and the code in this repository: sign-in and accounts, access to other people's projects and ideas, the GitHub integration (what the app may do in a repository), the AI features (prompt injection, leaking keys or other people's data), payments and the public support pages and widget.

## How it is protected

The main protections and the tests that pin them are described in the README (owner and account handling, sign-in limits and email confirmation, who may use which repository, the AI workflow's sandbox and credentials, request and field limits, security headers and the server-side request guard). If you find a way around one of them, that is exactly the kind of report wanted.

## Supported versions

Only the latest version on `main` (the deployed one) is supported.
