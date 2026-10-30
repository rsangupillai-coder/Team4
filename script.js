(() => {
  "use strict";
  const MODEL_URL = "https://teachablemachine.withgoogle.com/models/DrZVgPRsH/";
  const FRUITS = {
    Apples: { emoji: "🍎", advice: "Apples are crisp fruits that grow on trees. Their skin can be red, green, or yellow." },
    Bananas: { emoji: "🍌", advice: "Bananas grow in bunches and are a good source of potassium and fiber." },
    Oranges: { emoji: "🍊", advice: "Oranges are citrus fruits known for their juicy segments and vitamin C." }
  };
  const $ = (id) => document.getElementById(id);
  const state = {
    model: null, modelPromise: null, webcam: null, cameraActive: false,
    inputMode: "camera", image: null, imageData: null, predictions: null,
    topFruit: null, confidence: null, history: [], undoRecord: null
  };
  const STORAGE_KEY = "fruit-identifiers-history-v1";
  const historyGrid = $("historyGrid");

  function readHistory() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch { return []; }
  }
  state.history = readHistory();

  function setStatus(message, type = "") {
    const el = $("scanStatus");
    el.textContent = message;
    el.className = "inline-status" + (type ? " " + type : "");
  }
  function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), 2300);
  }
  function navigate(route) {
    const allowed = ["home", "scan", "results", "check", "history"];
    const next = allowed.includes(route) ? route : "home";
    if (next !== "scan" && state.cameraActive) stopCamera(false);
    document.querySelectorAll(".screen").forEach(s => s.classList.toggle("active", s.dataset.screen === next));
    document.querySelectorAll(".nav-link").forEach(a => a.classList.toggle("active", a.dataset.route === next));
    $("mainNav").classList.remove("open");
    $("menuToggle").setAttribute("aria-expanded", "false");
    if (location.hash !== "#" + next) history.replaceState(null, "", "#" + next);
    if (next === "history") renderHistory();
    if (next === "results") renderResults();
    if (next === "check") updateQuizContext();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  document.querySelectorAll("[data-route]").forEach(a => a.addEventListener("click", e => {
    e.preventDefault(); navigate(a.dataset.route);
  }));
  document.querySelectorAll('main a[href="#scan"],main a[href="#check"],main a[href="#home"]').forEach(a => a.addEventListener("click", e => {
    const route = a.getAttribute("href").slice(1);
    if (route) { e.preventDefault(); navigate(route); }
  }));
  $("menuToggle").addEventListener("click", () => {
    const open = $("mainNav").classList.toggle("open");
    $("menuToggle").setAttribute("aria-expanded", String(open));
  });
  window.addEventListener("hashchange", () => navigate(location.hash.slice(1)));

  async function loadModel() {
    if (state.model) return state.model;
    if (state.modelPromise) return state.modelPromise;
    if (!window.tmImage) throw new Error("The image-model library did not load. Check your internet connection and reload.");
    state.modelPromise = (async () => {
      setStatus("Loading the fruit recognition model…", "");
      state.model = await tmImage.load(MODEL_URL + "model.json", MODEL_URL + "metadata.json");
      const labels = state.model.getClassLabels ? state.model.getClassLabels() : [];
      const expected = ["Apples", "Bananas", "Oranges"];
      if (labels.length && expected.some(label => !labels.includes(label))) {
        throw new Error("The connected model's class labels do not match Apples, Bananas, and Oranges.");
      }
      return state.model;
    })();
    try { return await state.modelPromise; }
    catch (err) { state.modelPromise = null; state.model = null; throw err; }
  }

  function stopCamera(showMessage = true) {
    if (state.webcam) {
      try { state.webcam.stop(); } catch (_) {}
      state.webcam = null;
    }
    if (state.cameraStream) {
      state.cameraStream.getTracks().forEach(track => track.stop());
      state.cameraStream = null;
    }
    state.cameraActive = false;
    $("cameraVideo").hidden = true;
    $("cameraVideo").srcObject = null;
    $("viewfinderEmpty").hidden = false;
    $("viewfinderLabel").textContent = "READY WHEN YOU ARE";
    $("cameraState").classList.remove("on");
    $("cameraState").innerHTML = "<i></i> CAMERA OFF";
    $("startCamera").disabled = false;
    $("stopCamera").disabled = true;
    $("captureIdentify").disabled = true;
    if (showMessage) setStatus("Camera stopped. Start it again or upload an image.");
  }
  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("Camera access is not available in this browser. Try uploading an image instead.", "error");
      return;
    }
    try {
      setStatus("Requesting camera permission…");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      const video = $("cameraVideo");
      video.srcObject = stream;
      await video.play();
      state.cameraActive = true;
      $("viewfinderEmpty").hidden = true;
      $("uploadPreview").hidden = true;
      video.hidden = false;
      $("cameraState").classList.add("on");
      $("cameraState").innerHTML = "<i></i> CAMERA ON";
      $("viewfinderLabel").textContent = "LIVE CAMERA";
      $("startCamera").disabled = true;
      $("stopCamera").disabled = false;
      $("captureIdentify").disabled = false;
      setStatus("Camera is ready. Center one fruit, then capture and identify.", "success");
      // Keep the stream in the video element; prediction uses its live frame.
      state.cameraStream = stream;
    } catch (err) {
      setStatus(err.name === "NotAllowedError"
        ? "Camera permission was denied. Allow camera access in your browser settings, or upload a photo."
        : "Could not start the camera. Check that another app is not using it, or upload a photo.", "error");
      stopCamera(false);
    }
  }

  function setImagePreview(img, dataUrl) {
    state.image = img;
    state.imageData = dataUrl;
    $("cameraVideo").hidden = true;
    $("viewfinderEmpty").hidden = true;
    $("uploadPreview").src = dataUrl;
    $("uploadPreview").hidden = false;
    $("viewfinderLabel").textContent = "IMAGE READY";
    $("captureIdentify").disabled = false;
    setStatus("Image ready. Select Capture & identify to run the model.", "success");
  }

  $("cameraTab").addEventListener("click", () => {
    state.inputMode = "camera";
    $("cameraTab").classList.add("selected");
    $("uploadTab").classList.remove("selected");
    $("cameraTab").setAttribute("aria-selected", "true");
    $("uploadTab").setAttribute("aria-selected", "false");
    $("scannerTitle").textContent = "Camera viewfinder";
    $("uploadControls").hidden = true;
    $("startCamera").hidden = false;
    $("stopCamera").hidden = false;
    $("captureIdentify").hidden = false;
    $("viewfinderEmpty").hidden = false;
    $("uploadPreview").hidden = true;
    if (!state.cameraActive) $("cameraVideo").hidden = true;
  });
  $("uploadTab").addEventListener("click", () => {
    state.inputMode = "upload";
    if (state.cameraActive) stopCamera(false);
    $("uploadTab").classList.add("selected");
    $("cameraTab").classList.remove("selected");
    $("uploadTab").setAttribute("aria-selected", "true");
    $("cameraTab").setAttribute("aria-selected", "false");
    $("scannerTitle").textContent = "Upload a fruit photo";
    $("uploadControls").hidden = false;
    $("startCamera").hidden = true;
    $("stopCamera").hidden = true;
    $("captureIdentify").hidden = false;
    $("captureIdentify").disabled = !state.image;
    $("viewfinderEmpty").hidden = !state.image;
    $("cameraVideo").hidden = true;
  });
  $("startCamera").addEventListener("click", startCamera);
  $("stopCamera").addEventListener("click", () => stopCamera());

  $("imageInput").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setStatus("Please choose a valid image file.", "error"); return; }
    if (state.cameraActive) stopCamera(false);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const img = new Image();
      img.onload = () => setImagePreview(img, dataUrl);
      img.onerror = () => setStatus("That image could not be opened. Try another file.", "error");
      img.src = dataUrl;
    } catch {
      setStatus("Could not read that image. Try another file.", "error");
    }
  });

  function getCameraFrame() {
    const video = $("cameraVideo");
    if (!video.videoWidth || !video.videoHeight) throw new Error("The camera is not ready yet. Wait for the preview, then try again.");
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    return { source: canvas, data: canvas.toDataURL("image/jpeg", .86) };
  }

  async function identify() {
    let source, imageData;
    try {
      if (state.inputMode === "camera") {
        if (!state.cameraActive) { setStatus("Start the camera first, or switch to image upload.", "error"); return; }
        const frame = getCameraFrame(); source = frame.source; imageData = frame.data;
      } else {
        if (!state.image) { setStatus("Choose an image before identifying.", "error"); return; }
        source = state.image; imageData = state.imageData;
      }
      $("captureIdentify").disabled = true;
      setStatus("Analyzing your fruit image…");
      const model = await loadModel();
      const raw = await model.predict(source);
      const predictions = raw.map(p => ({ className: p.className, probability: Number(p.probability) }))
        .filter(p => ["Apples", "Bananas", "Oranges"].includes(p.className))
        .sort((a, b) => b.probability - a.probability);
      if (predictions.length !== 3) throw new Error("The model did not return all three expected classes. Check the model's class names.");
      state.predictions = predictions;
      state.topFruit = predictions[0].className;
      state.confidence = predictions[0].probability;
      state.imageData = imageData;
      state.image = source;
      renderResults();
      setStatus("Scan complete. Actual model predictions are shown on the Results screen.", "success");
      navigate("results");
    } catch (err) {
      setStatus(err.message || "Something went wrong while identifying this image. Try again.", "error");
    } finally {
      $("captureIdentify").disabled = state.inputMode === "camera" ? !state.cameraActive : !state.image;
    }
  }
  $("captureIdentify").addEventListener("click", identify);

  function renderResults() {
    const predictions = state.predictions;
    if (!predictions) return;
    const top = predictions[0];
    const fruit = FRUITS[top.className];
    $("predictionEmoji").textContent = fruit.emoji;
    $("predictionName").textContent = top.className;
    $("confidenceBig").innerHTML = (top.probability * 100).toFixed(1) + '%<small>CONFIDENCE</small>';
    $("predictionMessage").textContent = top.probability < .55
      ? "This result is uncertain. Try a clearer photo with one fruit centered."
      : "The model's strongest match is " + top.className.toLowerCase() + ".";
    $("fruitAdvice").textContent = fruit.advice;
    $("resultFootnote").textContent = top.probability < .55
      ? "Low-confidence result: treat this as a guess, not a definite identification."
      : "Confidence is the model's score for each class, not a guarantee of correctness.";
    if (state.imageData) {
      $("resultImage").src = state.imageData;
      $("resultImage").hidden = false;
      $("resultImagePlaceholder").hidden = true;
    }
    $("confidenceBars").innerHTML = "";
    predictions.forEach(p => {
      const row = document.createElement("div"); row.className = "bar-row";
      const label = document.createElement("div"); label.className = "bar-label";
      const name = document.createElement("span"); name.textContent = FRUITS[p.className].emoji + "  " + p.className;
      const value = document.createElement("span"); value.textContent = (p.probability * 100).toFixed(1) + "%";
      label.append(name, value);
      const track = document.createElement("div"); track.className = "bar-track";
      const fill = document.createElement("div"); fill.className = "bar-fill"; fill.style.width = Math.max(0, Math.min(100, p.probability * 100)) + "%";
      track.append(fill); row.append(label, track); $("confidenceBars").append(row);
    });
  }

  function makeRecord() {
    if (!state.predictions) return null;
    return {
      id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()),
      fruit: state.topFruit, confidence: state.confidence,
      predictions: state.predictions, imageData: state.imageData || "",
      createdAt: new Date().toISOString()
    };
  }
  function persistHistory() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.history)); }
    catch { toast("Browser storage is full. Try saving a smaller image."); }
    renderHistory();
  }
  $("saveScan").addEventListener("click", () => {
    const record = makeRecord();
    if (!record) { $("saveFeedback").textContent = "Scan a fruit before saving."; return; }
    if (state.history.some(item => item.id === record.id)) return;
    state.history.push(record);
    state.undoRecord = null;
    persistHistory();
    $("saveFeedback").textContent = "Scan saved to your history.";
    toast("Scan saved");
  });
  $("undoSave").addEventListener("click", () => {
    if (!state.history.length) return;
    state.undoRecord = state.history.pop();
    persistHistory();
    toast("Last saved scan undone");
  });
  $("nextItem").addEventListener("click", resetForNext);
  $("scanAgain").addEventListener("click", () => navigate("scan"));
  function resetForNext() {
    state.image = null; state.imageData = null; state.predictions = null; state.topFruit = null; state.confidence = null;
    $("imageInput").value = "";
    $("resultImage").hidden = true; $("resultImagePlaceholder").hidden = false;
    $("resultImagePlaceholder").innerHTML = "🍎<span>Your scan will appear here</span>";
    $("saveFeedback").textContent = "";
    $("cameraTab").click();
    navigate("scan");
    setStatus("Ready for your next fruit.");
  }

  function updateQuizContext() {
    $("quizFruit").textContent = state.topFruit ? FRUITS[state.topFruit].emoji : "🍎";
    $("quizFeedback").className = "quiz-feedback";
    $("quizFeedback").textContent = state.topFruit
      ? "Your latest scan predicts " + state.topFruit + ". Which fruit do you think it is?"
      : "Scan a fruit first, then choose your answer.";
    document.querySelectorAll(".quiz-options button").forEach(b => b.classList.remove("selected"));
  }
  $("quizOptions").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-fruit]");
    if (!button) return;
    document.querySelectorAll(".quiz-options button").forEach(b => b.classList.toggle("selected", b === button));
    if (!state.topFruit) {
      $("quizFeedback").className = "quiz-feedback bad";
      $("quizFeedback").textContent = "No scan to compare yet. Go to Scan and identify a fruit first.";
      return;
    }
    const choice = button.dataset.fruit;
    const correct = choice === state.topFruit;
    $("quizFeedback").className = "quiz-feedback " + (correct ? "good" : "bad");
    $("quizFeedback").textContent = correct
      ? "✓ Correct by the demo rule! Your choice matches the model's top prediction: " + state.topFruit + "."
      : "Not a match by the demo rule. You chose " + choice + ", while the model predicted " + state.topFruit + ". Try again or scan another fruit.";
  });
  $("resetQuiz").addEventListener("click", updateQuizContext);

  function renderHistory() {
    $("historyCount").textContent = String(state.history.length);
    $("historySub").textContent = state.history.length
      ? state.history.length + " saved " + (state.history.length === 1 ? "discovery" : "discoveries") + "."
      : "No scans saved yet. Your collection starts at zero.";
    $("undoSave").disabled = state.history.length === 0;
    if (!state.history.length) {
      historyGrid.innerHTML = '<div class="history-empty"><span>🍃</span><h3>A fresh start.</h3><p>When you save a scan, it will show up here.</p><a class="btn btn-primary" href="#scan">Make your first scan</a></div>';
      const cta = historyGrid.querySelector("a");
      cta.addEventListener("click", e => { e.preventDefault(); navigate("scan"); });
      return;
    }
    historyGrid.innerHTML = "";
    [...state.history].reverse().forEach(record => {
      const card = document.createElement("article"); card.className = "history-card";
      if (record.imageData) {
        const img = document.createElement("img"); img.src = record.imageData; img.alt = "Saved " + record.fruit + " scan"; card.append(img);
      } else {
        const placeholder = document.createElement("div"); placeholder.className = "history-placeholder"; placeholder.textContent = FRUITS[record.fruit]?.emoji || "🍃"; card.append(placeholder);
      }
      const body = document.createElement("div"); body.className = "history-card-body";
      const title = document.createElement("strong"); title.textContent = (FRUITS[record.fruit]?.emoji || "") + " " + record.fruit;
      const detail = document.createElement("p"); detail.textContent = "Identified with " + (record.confidence * 100).toFixed(1) + "% confidence";
      const date = document.createElement("small"); date.textContent = new Date(record.createdAt).toLocaleString();
      body.append(title, detail, date); card.append(body); historyGrid.append(card);
    });
  }

  // Clean up camera tracks when the tab is closed or navigated away from.
  window.addEventListener("pagehide", () => {
    if (state.cameraStream) state.cameraStream.getTracks().forEach(track => track.stop());
  });
  renderHistory();
  const initial = location.hash.slice(1) || "home";
  navigate(initial);
})();