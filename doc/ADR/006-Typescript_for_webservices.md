# Typescript for webservices

## Status

_accepted_

## Context

The two most mainstream languages for serverless backends are Python and Typescript (Node.js). Superficially, both languages are at parity for the purpose of running a simple webservice on AWS Lambda, but there are differences:

- In the data and machine learning domain, Python is leading with decades of investments in relevant tooling and frameworks.
- In the webservices domain, Node.js (JavaScript) is the [dominant language](https://survey.stackoverflow.co/2024/technology).

Node.js is the best supported, most performant runtime on AWS unless moving to a compiled language. Most full-stack engineers can be expected to have some familiarity with Typescript.

## Decision

- We will write our backend in Node.js/Typescript

## Non-decision

- Python remains a strong choice for data engineering workloads
- Existing Python backends are unaffected by this decision

## Consequences

- We commit to Node.js/Typescript for new webservices
