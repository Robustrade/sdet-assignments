from ui.pages.subscription_status_page import SubscriptionStatusPage
from ui.web_inspector import WebInspector


def test_subscription_status_page_shows_the_current_plan_and_status(inspector: WebInspector) -> None:
    page = SubscriptionStatusPage(inspector).load()

    assert page.plan_name() == "Pro"
    assert page.status() == "Active"


def test_canceling_updates_the_status_badge(inspector: WebInspector) -> None:
    page = SubscriptionStatusPage(inspector).load()

    page.cancel_subscription()

    assert page.status() == "Canceled"
    assert page.is_cancel_confirmation_visible()
    assert not page.is_cancel_button_enabled()
