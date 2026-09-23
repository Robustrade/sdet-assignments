from pathlib import Path

from ui.pages.base_page import BasePage

FIXTURE_PATH = Path(__file__).parent.parent / "fixtures" / "subscription_status.html"


class SubscriptionStatusPage(BasePage):
    url = FIXTURE_PATH.as_uri()

    PLAN_NAME = "#plan-name"
    STATUS_BADGE = "#status-badge"
    CANCEL_BUTTON = "#cancel-button"
    CANCEL_CONFIRMATION = "#cancel-confirmation"

    def plan_name(self) -> str:
        return self._inspector.text_of(self.PLAN_NAME)

    def status(self) -> str:
        return self._inspector.text_of(self.STATUS_BADGE)

    def cancel_subscription(self) -> "SubscriptionStatusPage":
        self._inspector.click(self.CANCEL_BUTTON)
        return self

    def is_cancel_button_enabled(self) -> bool:
        return self._inspector.is_enabled(self.CANCEL_BUTTON)

    def is_cancel_confirmation_visible(self) -> bool:
        return self._inspector.is_visible(self.CANCEL_CONFIRMATION)
