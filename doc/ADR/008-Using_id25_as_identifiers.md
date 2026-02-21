# Using id25 as primary identifiers

## Status

_accepted_

## Context

Our canonical services need globally, unique identifiers. A logical choice is to use the UUID standard. The binary representation of a UUID is very compact (16 bytes) but the string representation relatively large: The typical representation of a UUID is a 32-character hexadecimal string, divided into five groups separated by hyphens: 8-4-4-4-12. This results in a total of 36 characters, including the hyphens, for example: 5b31ab9a-a509-40cd-a631-a9e6b69673a2.

For use-cases where we interact with identifiers as strings, such as URLs, HTTP bodies, CLI tools and user-interfaces, a shorter representation is better.

Some well-known representations:

| encoding      | resulting string                 | length |
| ------------- | -------------------------------- | ------ |
| BASE16 (HEX)  | 5b31ab9aa50940cda631a9e6b69673a2 | 32     |
| BASE36 (ID25) | 5eczej9lbv17hkqj8392ha2ea        | 25     |
| BASE64        | WzGrmqUJQM2mMQAAqea2lg           | 23     |

While the BASE64 representation is by far the shortest, it requires lowercase/upper case characters and it includes ASCII characters that require URL encoding and special treatment in terminals.
Base36 uses [a-z] and [0-9]. This makes it the shortest, most portable representation of a 16 bit UUID in text, easy to copy (double click) and no special handling required anywhere else.

While UUIDv4 is a fully random UUID, UUIDv5 is based on hashing a namespace with a value. This makes it deterministic and provides enough uniqueness if the encoded value contains enough entropy, and doesn't require a good source of entropy.

For most use-cases, UUIDs are essentially overkill, but they are well known and natively supported by most major programming languages. Encoding UUIDs in different formats is well documented and supported by 3rd party libraries [1](https://pypi.org/project/uuid25/), [2](https://www.npmjs.com/package/short-uuid).

## Decision

- Use UUID(v4) as primary identifier.
- Use UUIDv5 as deterministically generated identifiers for locally unique values.
- Represent UUIDs as base36 strings when needed.

## Consequences

- We consistently require 25 character identifiers in all API contracts
- We require 25 character IDs to be valid 16 bit UUIDs
