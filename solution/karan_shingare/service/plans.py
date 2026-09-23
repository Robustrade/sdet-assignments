from dataclasses import dataclass


@dataclass(frozen=True)
class Plan:
    id: str
    price_cents: int
    currency: str
    trial_days: int


# Two tiers with different trial behavior on purpose: "basic" exercises the
# trial-first creation path, "pro" exercises the charge-immediately path.
PLANS: dict[str, Plan] = {
    "basic": Plan(id="basic", price_cents=1900, currency="USD", trial_days=14),
    "pro": Plan(id="pro", price_cents=4900, currency="USD", trial_days=0),
}
