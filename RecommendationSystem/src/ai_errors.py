"""Shared stable errors for the local intelligence boundary."""
class AIError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status
