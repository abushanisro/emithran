"""An upload's extension and size are checked before anything is written to disk (main.read_checked_upload)."""
import io
import tempfile

import pytest
from fastapi.testclient import TestClient

import main
from shared.exceptions import FileSizeExceededError, InvalidFileTypeError
from shared.validators import FileValidator


def test_the_extension_is_checked_before_the_content_is_read():
    stream = io.BytesIO(b"#!/bin/sh\n")
    with pytest.raises(InvalidFileTypeError):
        FileValidator(max_file_size_bytes=1024).read_upload(stream, "evil.sh")
    assert stream.tell() == 0  # nothing read


def test_an_oversized_upload_is_refused_after_reading_one_byte_past_the_limit():
    stream = io.BytesIO(b"x" * 10_000)
    with pytest.raises(FileSizeExceededError):
        FileValidator(max_file_size_bytes=100).read_upload(stream, "part.step")
    assert stream.tell() == 101


def test_an_allowed_upload_comes_back_with_its_checked_extension():
    ext, content = FileValidator(max_file_size_bytes=100).read_upload(io.BytesIO(b"ISO-10303-21;"), "Part.STP")
    assert (ext, content) == (".stp", b"ISO-10303-21;")


@pytest.mark.parametrize(
    ("name", "size"),
    [("evil.sh", 10), ("../../x.py", 10), ("part.step", 10_000)],
)
def test_the_api_refuses_before_creating_a_temp_file(monkeypatch, name, size):
    created = []
    real = tempfile.NamedTemporaryFile

    def spy(*args, **kwargs):
        created.append(kwargs.get("suffix"))
        return real(*args, **kwargs)

    monkeypatch.setattr(main.tempfile, "NamedTemporaryFile", spy)
    with TestClient(main.app) as client:
        monkeypatch.setattr(client.app.state.file_validator, "max_file_size_bytes", 1_000)
        response = client.post(
            "/analyze/geometry",
            files={"file": (name, b"x" * size, "application/octet-stream")},
            headers={"X-API-Key": main._CAD_API_KEY},
        )
    assert response.status_code == 400
    assert created == []
