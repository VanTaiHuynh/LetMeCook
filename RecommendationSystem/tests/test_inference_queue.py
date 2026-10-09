import threading
import time
import unittest
from src.inference_queue import InferenceQueue, QueueBusy, task


class InferenceQueueTests(unittest.TestCase):
    def wait_for(self, predicate):
        deadline = time.monotonic() + 1
        while not predicate() and time.monotonic() < deadline:
            time.sleep(.001)
        self.assertTrue(predicate())

    def test_cook_jumps_queued_text_without_interrupting_active_model(self):
        queue = InferenceQueue(capacity=4, wait_seconds=1, burst=10)
        order, errors = [], []
        def run(kind):
            try:
                with queue.slot(kind):
                    order.append(kind)
            except Exception as error:
                errors.append(error)
        with queue.slot("vision"):
            text = threading.Thread(target=run, args=("text",))
            text.start()
            self.wait_for(lambda: queue.status()["queued"] == 1)
            cook = threading.Thread(target=run, args=("cook",))
            cook.start()
            self.wait_for(lambda: queue.status()["queued"] == 2)
            self.assertEqual([], order)
        text.join(2)
        cook.join(2)
        self.assertEqual([], errors)
        self.assertEqual(["cook", "text"], order)

    def test_capacity_rejects_instead_of_unbounded_queue(self):
        queue = InferenceQueue(capacity=1)
        with queue.slot("cook"):
            with self.assertRaises(QueueBusy):
                with queue.slot("vision"):
                    self.fail("Full queue must not admit")
        self.assertEqual(1, queue.status()["rejected"])

    def test_wait_timeout_removes_job_and_does_not_hold_lane(self):
        queue = InferenceQueue(capacity=2, wait_seconds=.02)
        errors = []
        def waiting():
            try:
                with queue.slot("text"):
                    self.fail("Should expire")
            except QueueBusy as error:
                errors.append(error)
        with queue.slot("cook"):
            thread = threading.Thread(target=waiting)
            thread.start()
            thread.join(1)
            self.assertEqual(1, len(errors))
            self.assertEqual(0, queue.status()["queued"])
        with queue.slot("cook"):
            self.assertEqual("cook", queue.status()["active"])

    def test_rate_budget_and_exception_cleanup(self):
        queue = InferenceQueue(burst=1, requests_per_minute=1)
        with self.assertRaises(RuntimeError):
            with queue.slot():
                raise RuntimeError("Model failed")
        self.assertIsNone(queue.status()["active"])
        with self.assertRaises(QueueBusy):
            with queue.slot():
                pass
        queue = InferenceQueue(burst=2)
        with task("plan"), queue.slot():
            self.assertEqual("plan", queue.status()["active"])
        with queue.slot():
            self.assertEqual("text", queue.status()["active"])


if __name__ == "__main__":
    unittest.main()
