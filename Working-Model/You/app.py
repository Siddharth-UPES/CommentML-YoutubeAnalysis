from flask import Flask, request, jsonify
from flask_cors import CORS
import joblib
import re
import requests

app = Flask(__name__)
CORS(app)

# ---------------- CONFIG ----------------
YOUTUBE_API_KEY = "*********************************"

# ----------- Load Model + Vectorizer -----------
try:
    model = joblib.load("final_svm_model.pkl")
    vectorizer = joblib.load("final_vectorizer.pkl")
    print(" Model & Vectorizer Loaded Successfully!")
except Exception as e:
    print(f" Error loading model/vectorizer: {e}")
    raise

# ----------- Clean Text Function -----------
def clean_text(text):
    text = (text or "").lower()
    text = re.sub(r"<.*?>", "", text)
    text = re.sub(r"[^a-zA-Z\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text

# ----------- /predict (single comment) -----------
@app.route("/predict", methods=["POST"])
def predict():
    data = request.json
    comment = data.get("comment", "")
    if not comment:
        return jsonify({"error": "No comment provided"}), 400

    cleaned = clean_text(comment)
    X = vectorizer.transform([cleaned])
    pred = model.predict(X)[0]

    try:
        pred_int = int(pred)
    except:
        mapping = {"positive": 1, "negative": -1, "neutral": 0}
        pred_int = mapping.get(str(pred).lower(), 0)

    return jsonify({"sentiment": pred_int})

# ----------- Fetch YouTube comments (shorts / reels supported) -----------
def fetch_comments(video_id, maxResults=1000):
    comments = []
    url = f"https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId={video_id}&maxResults=100&key={YOUTUBE_API_KEY}"
    while url and len(comments) < maxResults:
        try:
            resp = requests.get(url, timeout=10)
            data = resp.json()
        except Exception as e:
            print("Error fetching comments:", e)
            break

        if "items" not in data:
            break

        for item in data["items"]:
            try:
                text = item["snippet"]["topLevelComment"]["snippet"].get("textDisplay") or ""
                comments.append(text)
            except Exception:
                continue

        url = data.get("nextPageToken")
        if url:
            url = f"https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId={video_id}&maxResults=100&key={YOUTUBE_API_KEY}&pageToken={data['nextPageToken']}"
        else:
            url = None

    return comments[:maxResults]

# ----------- Analyze Video (score 0–10) -----------
def analyze_video_comments(video_id):
    comments = fetch_comments(video_id, maxResults=1000)
    if not comments:
        return {"total": 0, "pos": 0, "neg": 0, "neu": 0, "score_10": 0}

    cleaned_comments = [clean_text(c) for c in comments]
    X = vectorizer.transform(cleaned_comments)
    preds = model.predict(X)

    mapped = []
    for p in preds:
        try:
            mapped.append(int(p))
        except:
            s = str(p).lower()
            if s in ("positive", "pos", "1"): mapped.append(1)
            elif s in ("negative", "neg", "-1"): mapped.append(-1)
            else: mapped.append(0)

    total = len(mapped)
    pos = mapped.count(1)
    neg = mapped.count(-1)
    neu = mapped.count(0)
    net_ratio = (pos - neg) / total if total > 0 else 0
    score_10 = round((net_ratio + 1) * 5)

    return {"total": total, "pos": pos, "neg": neg, "neu": neu, "score_10": score_10}

# ----------- /analyze_video endpoint -----------
@app.route("/analyze_video", methods=["POST"])
def analyze_video_endpoint():
    data = request.json
    video_id = data.get("video_id")
    if not video_id:
        return jsonify({"error": "No video id provided"}), 400

    result = analyze_video_comments(video_id)
    return jsonify(result)

# ----------- /search_topic endpoint -----------
@app.route("/search_topic", methods=["POST"])
def search_topic():
    data = request.json
    query = data.get("query")
    if not query:
        return jsonify({"error": "No query provided"}), 400

    url = f"https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q={query}&maxResults=5&key={YOUTUBE_API_KEY}"
    res = requests.get(url)
    search_data = res.json()
    videos = []

    for item in search_data.get("items", []):
        video_id = item["id"].get("videoId")
        if not video_id:
            continue
        sentiment = analyze_video_comments(video_id)
        videos.append({
            "videoId": video_id,
            "title": item["snippet"]["title"],
            "channel": item["snippet"]["channelTitle"],
            "score_10": sentiment["score_10"],
            "total_comments": sentiment["total"]
        })

    # Sort videos by score
    videos.sort(key=lambda x: x["score_10"], reverse=True)
    best_video = videos[0] if videos else None

    return jsonify({"top_videos": videos, "best_video": best_video, "query": query})

if __name__ == "__main__":
    app.run(port=5000, debug=True)