"""ComponentFeatureCache: LRU in memory, files on disk that survive a restart, keyed by the analyzer's own source."""
import json
import time

from shared import part_analysis
from shared.part_analysis import ComponentFeatureCache


def test_a_value_survives_a_restart_through_the_disk_file(tmp_path):
    first = ComponentFeatureCache(tmp_path)
    key = first.key("abc123")
    first.put(key, {"blank": 1})
    assert ComponentFeatureCache(tmp_path).get(key) == {"blank": 1}  # new instance = empty memory


def test_memory_keeps_only_the_most_recently_used_entries(tmp_path, monkeypatch):
    monkeypatch.setattr(part_analysis, "_CF_MAX_ENTRIES", 2)
    cache = ComponentFeatureCache(tmp_path)
    cache.put("a", 1)
    cache.put("b", 2)
    cache.get("a")  # a is now newer than b
    cache.put("c", 3)
    assert list(cache._memory) == ["a", "c"]
    assert cache.get("b") == 2  # evicted from memory, still on disk


def test_an_expired_disk_entry_is_a_miss_and_is_removed(tmp_path, monkeypatch):
    cache = ComponentFeatureCache(tmp_path)
    (tmp_path / "old.json").write_text(json.dumps({"ts": time.time() - 8 * 24 * 3600, "cf": {"x": 1}}))
    assert cache.get("old") is None
    assert not (tmp_path / "old.json").exists()


def test_changing_the_analyzer_source_changes_the_key(tmp_path, monkeypatch):
    before = ComponentFeatureCache(tmp_path).key("h")
    real = part_analysis.Path.read_bytes
    monkeypatch.setattr(part_analysis.Path, "read_bytes", lambda self: real(self) + b"\n# edited" if self.name == "component_feature_analyzer.py" else real(self))
    assert ComponentFeatureCache(tmp_path).key("h") != before
