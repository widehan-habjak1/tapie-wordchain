import assert from "node:assert/strict"
import test from "node:test"
import { normalizePhone } from "../shared/contact.ts"

test("phone input accepts separators and international prefixes without changing the digits", () => {
  assert.equal(normalizePhone("010-1234-5678"), "01012345678")
  assert.equal(normalizePhone(" +82 (10) 1234 5678 "), "+821012345678")
  assert.equal(normalizePhone("02-123-4567"), "021234567")
  for (const input of [undefined, "", "123", "call01012345678", "010+12345678", "1".repeat(16)]) assert.equal(normalizePhone(input), null)
})
