"""vitaradar.hu speech search: what did this MP say about ...?

GET /?mp=<mp id>&q=<question>  ->  {"hits": [{speech_id, session, date, at_s, text, score}, ...]}

The question is embedded with the same Vertex AI model the pipeline used for the MPs' passages
(text-multilingual-embedding-002, 768 dimensions), and Firestore returns that MP's nearest passages by cosine
distance (collection `chunks`, vector index on mp_id + embedding). Runs as a Cloud Run function in the
parlament-factcheck project; the passages are not readable from browsers, only through this function.
"""

import json
import os

import functions_framework
import google.auth
from google.auth.transport.requests import AuthorizedSession
from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter
from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
from google.cloud.firestore_v1.vector import Vector

PROJECT = os.environ.get("PROJECT", "parlament-factcheck")
LOCATION, MODEL = "europe-west4", "text-multilingual-embedding-002"
ORIGINS = {"https://kenyerman.github.io", "https://vitaradar.hu", "https://www.vitaradar.hu", "http://localhost:8099"}
MAX_Q, LIMIT = 300, 8

db = firestore.Client(project=PROJECT)
creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
http = AuthorizedSession(creds)
EMBED_URL = (f"https://{LOCATION}-aiplatform.googleapis.com/v1/projects/{PROJECT}/locations/{LOCATION}"
             f"/publishers/google/models/{MODEL}:predict")


def embed_query(q: str) -> list[float]:
    r = http.post(EMBED_URL, json={"instances": [{"content": q, "task_type": "RETRIEVAL_QUERY"}]}, timeout=20)
    r.raise_for_status()
    return r.json()["predictions"][0]["embeddings"]["values"]


def _reply(body: dict, status: int, origin: str):
    headers = {"Access-Control-Allow-Origin": origin if origin in ORIGINS else "https://vitaradar.hu",
               "Vary": "Origin", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Max-Age": "3600",
               "Content-Type": "application/json; charset=utf-8"}
    if status == 200:
        headers["Cache-Control"] = "public, max-age=300"
    return json.dumps(body, ensure_ascii=False), status, headers


@functions_framework.http
def search(request):
    origin = request.headers.get("Origin", "")
    if request.method == "OPTIONS":
        return _reply({}, 204, origin)
    mp = (request.args.get("mp") or "").strip()
    q = " ".join((request.args.get("q") or "").split())[:MAX_Q]
    if not mp or len(q) < 2:
        return _reply({"error": "both mp and q are required"}, 400, origin)
    vector = embed_query(q)
    query = (db.collection("chunks").where(filter=FieldFilter("mp_id", "==", mp))
             .find_nearest(vector_field="embedding", query_vector=Vector(vector), distance_measure=DistanceMeasure.COSINE,
                           limit=LIMIT, distance_result_field="distance"))
    hits = []
    for snap in query.get():
        d = snap.to_dict()
        hits.append({"speech_id": d.get("speech_id"), "session": d.get("session"), "date": d.get("date"),
                     "at_s": d.get("at_s"), "text": d.get("text"), "score": round(1.0 - float(d.get("distance", 1.0)), 3)})
    return _reply({"mp": mp, "q": q, "hits": hits}, 200, origin)
