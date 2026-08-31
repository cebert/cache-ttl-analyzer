#!/usr/bin/env python3
"""Tests for restore_queued_messages.

Run: python3 .claude/skills/publish-transcript/scripts/test_restore_queued_messages.py
"""

import unittest

from restore_queued_messages import PREFIX, restore


def enqueue(content, ts="2026-08-30T00:00:01Z"):
    return {"type": "queue-operation", "operation": "enqueue", "content": content, "timestamp": ts}


def user(content, ts="2026-08-30T00:00:00Z"):
    return {"type": "user", "message": {"role": "user", "content": content}, "timestamp": ts,
            "uuid": "u1", "sessionId": "s1"}


def assistant(ts="2026-08-30T00:00:02Z"):
    return {"type": "assistant", "message": {"role": "assistant", "content": []}, "timestamp": ts}


def recovered_texts(records):
    return [
        r["message"]["content"]
        for r in records
        if r.get("isMidTurnRecovery")
    ]


class RestoreTest(unittest.TestCase):
    def test_recovers_a_message_that_never_became_a_turn(self):
        out, found = restore([user("first"), enqueue("steering")])
        self.assertEqual(found, ["steering"])
        self.assertEqual(recovered_texts(out), [PREFIX + "steering"])

    def test_skips_a_queued_message_that_was_delivered_normally(self):
        # The dequeue path writes a real user record; recovering it would
        # publish the same message twice.
        out, found = restore([enqueue("later delivered"), user("later delivered")])
        self.assertEqual(found, [])
        self.assertEqual(recovered_texts(out), [])

    def test_matches_delivered_text_despite_whitespace_differences(self):
        out, _ = restore([enqueue("one   two\n"), user("one two")])
        self.assertEqual(recovered_texts(out), [])

    def test_matches_delivered_text_in_block_form(self):
        blocks = [{"type": "text", "text": "hello there"}]
        out, _ = restore([enqueue("hello there"), user(blocks)])
        self.assertEqual(recovered_texts(out), [])

    def test_skips_harness_plumbing(self):
        out, found = restore([
            enqueue("<task-notification>\nagent done\n</task-notification>"),
            enqueue("<system-reminder>note</system-reminder>"),
            enqueue("  <local-command-stdout>x</local-command-stdout>"),
        ])
        self.assertEqual(found, [])
        self.assertEqual(recovered_texts(out), [])

    def test_deduplicates_a_message_enqueued_twice(self):
        out, found = restore([enqueue("same", "T1"), enqueue("same", "T2")])
        self.assertEqual(len(found), 1)
        self.assertEqual(len(recovered_texts(out)), 1)

    def test_ignores_empty_and_non_string_content(self):
        out, found = restore([enqueue(""), enqueue("   "), enqueue(None), enqueue({"a": 1})])
        self.assertEqual(found, [])

    def test_splices_the_recovery_at_its_own_enqueue(self):
        # It is rendered at the point in the log where it was typed, which is
        # mid-turn. Crucially the original records keep their order.
        out, _ = restore([
            user("first", "T0"),
            assistant("T5"),
            enqueue("mid", "T5"),
        ])
        kinds = [("recovered" if r.get("isMidTurnRecovery") else r["type"]) for r in out]
        self.assertEqual(kinds, ["user", "assistant", "recovered", "queue-operation"])

    def test_never_reorders_records_that_are_out_of_timestamp_order(self):
        # Sessions with subagent traffic are not stored strictly
        # chronologically, and sorting them cost five rendered prompts on one
        # real session. The original sequence must survive untouched.
        records = [
            user("first", "T9"),
            assistant("T1"),
            {"type": "assistant", "message": {"role": "assistant", "content": []}},
            enqueue("mid", "T3"),
            assistant("T2"),
        ]
        out, _ = restore(records)
        originals = [r for r in out if not r.get("isMidTurnRecovery")]
        self.assertEqual(originals, records)

    def test_preserves_every_original_record(self):
        records = [user("a"), assistant(), enqueue("b"),
                   {"type": "queue-operation", "operation": "remove", "content": "b",
                    "reason": "absorbed_mid_turn", "timestamp": "2026-08-30T00:00:03Z"}]
        out, _ = restore(records)
        for record in records:
            self.assertIn(record, out)

    def test_carries_session_identity_onto_the_synthetic_row(self):
        out, _ = restore([user("first"), enqueue("steering")])
        row = next(r for r in out if r.get("isMidTurnRecovery"))
        self.assertEqual(row["sessionId"], "s1")
        self.assertEqual(row["message"]["role"], "user")

    def test_leaves_a_session_without_queued_messages_untouched(self):
        records = [user("a"), assistant()]
        out, found = restore(records)
        self.assertEqual(out, records)
        self.assertEqual(found, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
