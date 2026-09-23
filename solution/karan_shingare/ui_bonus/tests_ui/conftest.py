from typing import Iterator

import pytest
from playwright.sync_api import Browser, sync_playwright

from ui.web_inspector import WebInspector


@pytest.fixture(scope="session")
def browser() -> Iterator[Browser]:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        yield browser
        browser.close()


@pytest.fixture
def inspector(browser: Browser) -> Iterator[WebInspector]:
    page = browser.new_page()
    yield WebInspector(page)
    page.close()
