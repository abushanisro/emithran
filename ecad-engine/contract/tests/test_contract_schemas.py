"""Python side of the feature-graph contract: the schemas under contract/schemas are the single source of truth.

The backend copies them into TypeScript (npm run electronics:sync-contract) and its test fails when the copy is stale.
No example documents are bundled: graphs come from real uploads.
"""
import json
from pathlib import Path

import pytest
from jsonschema import Draft7Validator

CONTRACT = Path(__file__).resolve().parent.parent
SCHEMAS = {
    "board": json.loads((CONTRACT / "schemas" / "board_feature_graph.v1.schema.json").read_text()),
    "harness": json.loads((CONTRACT / "schemas" / "harness_feature_graph.v1.schema.json").read_text()),
}


@pytest.mark.parametrize("schema", SCHEMAS.values(), ids=SCHEMAS.keys())
def test_schemas_are_valid_draft7(schema):
    Draft7Validator.check_schema(schema)
