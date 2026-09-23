from typing import Optional

from ui.web_inspector import WebInspector


class BasePage:
    url: Optional[str] = None

    def __init__(self, inspector: WebInspector) -> None:
        self._inspector = inspector

    def load(self) -> "BasePage":
        self._inspector.open(self.url)
        return self
