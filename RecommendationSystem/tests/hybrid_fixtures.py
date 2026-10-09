"""Synthetic public index fixtures. Vectors are authored, not Qwen evaluations."""
from types import MappingProxyType

import numpy as np


def document(recipe_id, title, *, ingredients=(), cuisines=(), categories=(),
             diets=(), minutes=30, views=0, rating=0, rating_count=0):
    return {"id": recipe_id, "title": title, "description": "",
            "ingredients": tuple(ingredients), "cuisines": tuple(cuisines),
            "categories": tuple(categories), "dietaryPreferences": tuple(diets),
            "cookingTime": minutes, "viewCount": views, "ratingAverage": rating,
            "ratingCount": rating_count}


class TrackingDocuments(dict):
    forbidden = frozenset()

    def __getitem__(self, key):
        if key in self.forbidden:
            raise AssertionError("Revoked document was read during this request")
        return super().__getitem__(key)


class SyntheticSnapshot:
    def __init__(self, documents, vectors):
        self.recipe_ids = tuple(value["id"] for value in documents)
        self.documents = TrackingDocuments({value["id"]: MappingProxyType(value) for value in documents})
        self.id_to_row = MappingProxyType({recipe_id: row for row, recipe_id in enumerate(self.recipe_ids)})
        values = np.asarray(vectors, dtype=np.float32)
        lengths = np.linalg.norm(values, axis=1, keepdims=True)
        self.embeddings = values / np.maximum(lengths, 1e-12)
        self.embeddings.setflags(write=False)
        self.manifest = {"encoder": {"model": "synthetic-fixed-vectors",
                                    "dimension": self.embeddings.shape[1], "digest": "synthetic"}}
        self.dense_calls = []

    def dense_search(self, vector, allowed_ids, limit=200):
        allowed = set(allowed_ids)
        self.dense_calls.append(allowed)
        rows = [self.id_to_row[recipe_id] for recipe_id in allowed if recipe_id in self.id_to_row]
        scores = self.embeddings[rows] @ vector
        order = sorted(zip(rows, scores), key=lambda value: (-float(value[1]), self.recipe_ids[value[0]]))
        return [(self.recipe_ids[row], float(score)) for row, score in order[:limit]]


def two_interest_snapshot():
    docs = [document("seed-savory", "Mushroom rice", ingredients=("mushroom", "rice")),
            document("seed-sweet", "Berry dessert", ingredients=("berry", "yogurt")),
            document("savory-a", "Mushroom bowl", ingredients=("mushroom", "rice"), categories=("dinner",)),
            document("savory-b", "Mushroom risotto", ingredients=("mushroom", "rice"), categories=("dinner",)),
            document("sweet-a", "Berry yogurt", ingredients=("berry", "yogurt"), categories=("dessert",)),
            document("other", "Fish tacos", ingredients=("fish", "tortilla"))]
    return SyntheticSnapshot(docs, [[1, 0, 0], [-1, 0, 0], [1, 0.01, 0], [1, 0.02, 0], [-1, 0.01, 0], [0, 0, 1]])
