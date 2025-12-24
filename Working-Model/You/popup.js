// ==================== CONFIG ====================
const YT_API_KEY = "*******************************";
const FLASK_BASE = "********************";
// =================================================

// Wait for DOM to load
document.addEventListener("DOMContentLoaded", () => {

  // Extract YouTube Video ID from link or raw ID
  function extractVideoID(url) {
    try {
      if (/^[A-Za-z0-9_-]{11}$/.test(url)) return url;
      let m = url.match(/[?&]v=([^&]+)/);
      if (m && m[1]) return m[1];
      m = url.match(/youtu\.be\/([^?&]+)/);
      if (m && m[1]) return m[1];
      m = url.match(/embed\/([^?&]+)/);
      if (m && m[1]) return m[1];
      return null;
    } catch {
      return null;
    }
  }

  // Call Flask ML Sentiment API
  async function getPrediction(comment) {
    try {
      const res = await fetch(`${FLASK_BASE}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment })
      });
      const data = await res.json();
      return data.sentiment ?? 0;
    } catch {
      return 0;
    }
  }

  // YouTube Search API
  async function searchVideosByTopic(query, maxResults = 5) {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=${encodeURIComponent(query)}&maxResults=${maxResults}&key=${YT_API_KEY}`;
    const res = await fetch(url);
    return await res.json();
  }

  // Get all comments for a video
  async function fetchAllComments(videoId, maxResults = 500) {
    let comments = [];
    let nextPageToken = "";
    const perRequest = 100;
    try {
      while (comments.length < maxResults) {
        const remaining = maxResults - comments.length;
        const count = remaining > perRequest ? perRequest : remaining;
        const url = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}&maxResults=${count}&key=${YT_API_KEY}${nextPageToken ? "&pageToken=" + nextPageToken : ""}`;
        const res = await fetch(url);
        const data = await res.json();
        if (!data.items || data.items.length === 0) break;
        for (let item of data.items) {
          const text = item.snippet.topLevelComment.snippet.textDisplay;
          comments.push(text);
        }
        if (!data.nextPageToken) break;
        nextPageToken = data.nextPageToken;
      }
    } catch (err) {
      console.error("Error fetching comments:", err);
    }
    return comments;
  }

  // ================= ACTION ====================
  const searchBtn = document.getElementById("searchBtn");
  searchBtn.addEventListener("click", async () => {
    const input = document.getElementById("topic").value.trim();
    const mode = document.getElementById("mode").value;
    const resultsDiv = document.getElementById("results");
    resultsDiv.innerHTML = "";

    if (!input) {
      resultsDiv.innerHTML = `<div class="card small"> Please enter a topic or YouTube link.</div>`;
      return;
    }

    // ---------- MODE 1: SINGLE VIDEO ----------
    if (mode === "video" || input.includes("youtube.com") || input.includes("youtu.be")) {
      const videoId = extractVideoID(input);
      if (!videoId) {
        resultsDiv.innerHTML = `<div class="card small"> Invalid YouTube Video Link.</div>`;
        return;
      }

      resultsDiv.innerHTML = `<div class="card small">⏳ Fetching comments for video...</div>`;
      const comments = await fetchAllComments(videoId, 1000);
      if (!comments || comments.length === 0) {
        resultsDiv.innerHTML = `<div class="card small">⚠ No comments found.</div>`;
        return;
      }

      let pos = 0, neg = 0, neu = 0;
      for (let text of comments) {
        const sentiment = await getPrediction(text);
        if (sentiment === 1) pos++;
        else if (sentiment === -1) neg++;
        else neu++;
      }

      const total = pos + neg + neu;
      const score = Math.round(((pos - neg + total) / (2 * total)) * 10);

      resultsDiv.innerHTML = `
        <div class="card">
          <h3>📊 Video Sentiment Analysis</h3>
          <p>
             Positive: <b>${pos}</b><br>
             Neutral: <b>${neu}</b><br>
             Negative: <b>${neg}</b><br>
             Total Comments Analyzed: <b>${total}</b><br>
             Score (0-10): <b>${score}</b>
          </p>
          <a href="https://www.youtube.com/watch?v=${videoId}" target="_blank">Open Video</a>
        </div>`;
      return;
    }

    // ---------- MODE 2: TOPIC SEARCH ----------
    resultsDiv.innerHTML = `<div class="card small">⏳ Searching for videos...</div>`;
    const search = await searchVideosByTopic(input, 5);
    if (!search.items || search.items.length === 0) {
      resultsDiv.innerHTML = `<div class="card small">⚠ No results found.</div>`;
      return;
    }

    const finalList = [];
    for (let item of search.items) {
      const videoId = item.id.videoId;
      const comments = await fetchAllComments(videoId, 200);
      let pos = 0, neg = 0, neu = 0;
      if (comments && comments.length > 0) {
        for (let text of comments) {
          const sentiment = await getPrediction(text);
          if (sentiment === 1) pos++;
          else if (sentiment === -1) neg++;
          else neu++;
        }
      }
      const score = pos - neg;
      finalList.push({
        videoId,
        title: item.snippet.title,
        channel: item.snippet.channelTitle,
        channelId: item.snippet.channelId,  // <--- ADD CHANNEL ID HERE
        score,
        pos,
        neg,
        neu,
        total: comments.length
      });
    }

    // Sort by score descending
    finalList.sort((a, b) => b.score - a.score);

    // Highlight best video
    const bestVideo = finalList[0];
    resultsDiv.innerHTML = `
      <div class="card highlight">
        <h3> Best Video for "${input}"</h3>
         <a href="https://www.youtube.com/watch?v=${bestVideo.videoId}" target="_blank">${bestVideo.title}</a><br>
         <a href="https://www.youtube.com/channel/${bestVideo.channelId}" target="_blank">
           ${bestVideo.channel}
         </a><br>
         Score: <b>${bestVideo.score}</b><br>
         Positive: <b>${bestVideo.pos}</b> | Neutral: <b>${bestVideo.neu}</b> | Negative: <b>${bestVideo.neg}</b> | Total: ${bestVideo.total}
      </div>
      <div class="card"><h3>📹 Top 5 Videos for "${input}"</h3></div>
    `;

    // Show other top 4 videos
    finalList.slice(1).forEach(v => {
      const div = document.createElement("div");
      div.className = "card";
      div.innerHTML = `
         <a href="https://www.youtube.com/watch?v=${v.videoId}" target="_blank">${v.title}</a><br>
         <a href="https://www.youtube.com/channel/${v.channelId}" target="_blank">${v.channel}</a><br>
         Score: <b>${v.score}</b><br>
         Positive: <b>${v.pos}</b> | Neutral: <b>${v.neu}</b> | Negative: <b>${v.neg}</b> | Total: ${v.total}
      `;
      resultsDiv.appendChild(div);
    });

    // Notes section
    const notesDiv = document.createElement("div");
    notesDiv.className = "card notes";
    const queryForNotes = encodeURIComponent(input + " notes");
    notesDiv.innerHTML = `
      <h3>📝 Topic Notes</h3>
      <a href="https://www.google.com/search?q=${queryForNotes}" target="_blank">
        Click here to view notes for "${input}" on Google
      </a>
    `;
    resultsDiv.appendChild(notesDiv);
  });

});
