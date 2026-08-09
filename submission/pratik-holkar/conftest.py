"""Root conftest. Registers the custom report plugin so its CLI options
are available no matter how pytest is invoked."""

pytest_plugins = ["plugins.report_plugin"]
