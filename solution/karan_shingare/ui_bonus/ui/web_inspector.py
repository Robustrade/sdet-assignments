from playwright.sync_api import Page


class WebInspector:
    """Thin, readable wrapper around a Playwright Page.

    Page objects talk to this, never to Playwright directly - keeps
    Playwright's API surface (and any future switch to another driver) out
    of the page object / test layer.
    """

    def __init__(self, page: Page) -> None:
        self._page = page

    def open(self, url: str) -> None:
        self._page.goto(url)

    def click(self, selector: str) -> None:
        self._page.click(selector)

    def fill(self, selector: str, text: str) -> None:
        self._page.fill(selector, text)

    def text_of(self, selector: str) -> str:
        return self._page.text_content(selector)

    def is_visible(self, selector: str) -> bool:
        return self._page.is_visible(selector)

    def is_enabled(self, selector: str) -> bool:
        return self._page.is_enabled(selector)

    def wait_for(self, selector: str, state: str = "visible") -> None:
        self._page.wait_for_selector(selector, state=state)
