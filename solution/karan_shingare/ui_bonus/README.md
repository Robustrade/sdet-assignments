# UI Automation Bonus (Page Object Model + WebInspector)

**Not part of the graded submission.** `SDET_ASSIGNMENT.md` explicitly lists a
frontend UI as a non-goal, and the Subscription & Billing service is a pure
REST/webhook API with nothing to click or render. This folder exists purely to
demonstrate a Page Object Model + Playwright-wrapper pattern on request, against
a tiny throwaway static HTML fixture (`ui/fixtures/subscription_status.html`) —
it proves nothing about the actual billing service and isn't referenced by
`STRATEGY.md` or `PR_DESCRIPTION.md`.

## Pattern

- `ui/web_inspector.py` — `WebInspector`: a thin, readable wrapper over a
  Playwright `Page` (`open`, `click`, `fill`, `text_of`, `is_visible`,
  `is_enabled`, `wait_for`). Page objects and tests only ever talk to this,
  never to Playwright's API directly.
- `ui/pages/base_page.py` — `BasePage`: common `load()` behavior for every page.
- `ui/pages/subscription_status_page.py` — `SubscriptionStatusPage`: one page
  object, selectors kept private, readable methods (`plan_name()`,
  `cancel_subscription()`, `is_cancel_confirmation_visible()`) exposed to tests.
- `tests_ui/` — pytest tests that only call page-object methods, never
  selectors or Playwright calls directly.

## Run it

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium
pytest -q
```
