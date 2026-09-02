import os

import pytest

# BEFORE anything else. pytest imports this file ahead of the test modules, and those
# modules import main at collection time - by which point main has already read
# ADMIN_TOKEN once and baked it in. Clearing it inside a fixture is too late; it has to
# happen here, at conftest import, or a developer with the variable exported in their
# shell watches nine admin-route tests fail with 401 and no explanation.
os.environ.pop("ADMIN_TOKEN", None)
os.environ.pop("DATABASE_URL", None)


@pytest.fixture(autouse=True)
def _clean_admin_token(monkeypatch):
    """Run every test as if no dealer access key were configured.

    main.py reads ADMIN_TOKEN once, at import. So a developer who has exported it in
    their shell - which anyone preparing a deploy will have done - suddenly sees nine
    admin-route tests fail with 401 and no clue why. That happened here, cost time, and
    was not a bug in anything being tested.

    Tests that need a key set it themselves through the app_client fixture, which runs
    after this one and re-imports main against its own value.
    """
    monkeypatch.delenv("ADMIN_TOKEN", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    yield


@pytest.fixture(autouse=True)
def _fail_loudly_on_ambient_config():
    """A last guard: if something still leaks config in, say so rather than confuse."""
    leaked = [k for k in ("ADMIN_TOKEN",) if os.getenv(k)]
    assert not leaked, (
        f"{leaked} is set in the environment during a test run. "
        "The suite clears it in conftest; something re-set it after."
    )
    yield
