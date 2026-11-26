const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzaGKpNJQwWKMqPMucbhvBmtdq-obaUlD8-ezo-avvzIleVAtjPvp5RL03AbNjEK1v6/exec";

let currentUser = null;
let dashboardData = null;
let attendSubMode = "qr";
let selectedAdminUser = null;

// Biến quét QR
let videoStream = null;
let scanLoopId = null;
let nativeDetector = null;
let isProcessingScan = false;
let lastCandidate = "";
let candidateStreak = 0;
let sharedAudioCtx = null;

if ('BarcodeDetector' in window) {
    try { nativeDetector = new BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { }
}

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => { });
}

/* ================= GỌI API ================= */
async function callApi(payload) {
    const res = await fetch(SCRIPT_URL, {
        method: "POST",
        body: JSON.stringify(payload)
    });
    return await res.json();
}

function showToast(msg, type = "", duration = 2500) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.className = "show " + type;
    clearTimeout(t._timer);
    if (duration > 0) {
        t._timer = setTimeout(() => { t.className = ""; }, duration);
    }
}

/* ================= ĐĂNG NHẬP & ĐIỀU HƯỚNG THEO ROLE ================= */
window.addEventListener("DOMContentLoaded", () => {
    const saved = localStorage.getItem("dd_user");
    if (saved) {
        currentUser = JSON.parse(saved);
        document.getElementById("login-screen").style.display = "none";
        setupNavigationByRole(true);
        refreshDashboard(false);
    }
});

async function handleLogin() {
    const username = document.getElementById("login-username").value.trim();
    const password = document.getElementById("login-password").value.trim();
    if (!username || !password) return showToast("Vui lòng nhập đủ thông tin!", "error");

    showToast("Đang đăng nhập...", "loading", 0);
    try {
        const res = await callApi({ action: "login", username, password });
        if (!res.success) return showToast(res.message, "error");

        currentUser = res.user;
        localStorage.setItem("dd_user", JSON.stringify(currentUser));
        document.getElementById("login-screen").style.display = "none";
        showToast("Đăng nhập thành công!", "success");
        setupNavigationByRole(true);
        refreshDashboard(false);
    } catch (e) {
        showToast("Lỗi kết nối máy chủ!", "error");
    }
}

function logout() {
    localStorage.removeItem("dd_user");
    stopCamera();
    location.reload();
}

function setupNavigationByRole(openDefaultTab = false) {
    const role = currentUser.role;

    document.querySelectorAll(".role-non-admin").forEach(el => {
        el.style.display = (role !== "admin") ? "flex" : "none";
    });
    document.querySelectorAll(".role-manager").forEach(el => {
        el.style.display = (role === "manager" || role === "admin") ? "flex" : "none";
    });
    document.querySelectorAll(".role-admin").forEach(el => {
        el.style.display = (role === "admin") ? "flex" : "none";
    });

    if (openDefaultTab) {
        if (role === "admin") {
            const btn = document.querySelector('.nav-item[data-tab="view-attendance"]');
            switchMainTab("view-attendance", "Điểm Danh", btn);
        } else {
            const btn = document.querySelector('.nav-item[data-tab="view-qr"]');
            switchMainTab("view-qr", "Thẻ Điểm Danh", btn);
        }
    }
}

function backToProfileTab() {
    const profileBtn = document.querySelector('.nav-item[data-tab="view-profile"]');
    switchMainTab("view-profile", "Thông Tin Cá Nhân", profileBtn);
}

function switchMainTab(tabId, title, btn) {
    document.querySelectorAll(".tab-view").forEach(v => v.classList.remove("active"));
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    document.getElementById(tabId).classList.add("active");
    if (btn) btn.classList.add("active");
    document.getElementById("header-title").textContent = title;

    if (tabId === "view-profile") {
        toggleProfileEdit(false);
    }

    if (tabId === "view-attendance" && attendSubMode === "qr") {
        startCamera();
    } else {
        stopCamera();
    }
}

async function refreshDashboard(manual = false) {
    if (manual) showToast("Đang đồng bộ dữ liệu...", "loading", 0);
    try {
        const res = await callApi({ action: "getDashboard", requesterId: currentUser.id });
        if (!res.success) {
            if (manual) showToast(res.message, "error");
            return;
        }
        dashboardData = res;
        currentUser = res.currentUser;
        localStorage.setItem("dd_user", JSON.stringify(currentUser));
        setupNavigationByRole(false);

        document.getElementById("header-date").textContent = "Hôm nay: " + res.today;

        if (currentUser.role !== "admin") {
            renderQRPage();
            renderMyHistory();
        }
        renderProfilePage();

        if (currentUser.role === "manager" || currentUser.role === "admin") {
            renderAttendanceList();
            renderAllStats();
        }
        if (currentUser.role === "admin") {
            renderAdminUsers();
        }
        if (manual) showToast("Đã cập nhật dữ liệu mới nhất!", "success", 1500);
    } catch (e) {
        if (manual) showToast("Lỗi tải dữ liệu!", "error");
    }
}

/* ================= TRANG 1: MÃ QR ĐIỂM DANH (USER & MANAGER) ================= */
function renderAvatarHTML(url, name) {
    if (url && url.trim() !== "") {
        return `<img src="${url}" alt="avatar" onerror="this.style.display='none'; this.parentNode.textContent='${getInitials(name)}'">`;
    }
    return getInitials(name);
}

function getInitials(name) {
    return name ? name.trim().split(" ").pop().charAt(0).toUpperCase() : "?";
}

function renderQRPage() {
    const u = currentUser;
    document.getElementById("qr-card-avatar").innerHTML = renderAvatarHTML(u.avatar, u.fullName);
    document.getElementById("qr-card-level").textContent = u.level || "Thành viên";
    document.getElementById("qr-card-fullname").textContent = u.fullName;
    document.getElementById("qr-card-position").textContent = u.position || "Chưa cập nhật chức vụ";

    const qrBox = document.getElementById("my-qrcode");
    qrBox.innerHTML = "";
    new QRCode(qrBox, {
        text: u.id,
        width: 195,
        height: 195,
        colorDark: "#002060",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
    });
}

/* ================= TRANG 2: LỊCH SỬ ĐIỂM DANH DẠNG MA TRẬN ================= */
function formatDayViFull(shortDay) {
    const map = {
        "T2": "Thứ Hai",
        "T3": "Thứ Ba",
        "T4": "Thứ Tư",
        "T5": "Thứ Năm",
        "T6": "Thứ Sáu",
        "T7": "Thứ Bảy",
        "CN": "Chủ Nhật"
    };
    return map[shortDay] || shortDay || "";
}

function parseVnDateToTimestamp(dateStr) {
    const parts = String(dateStr || "").split("/");
    if (parts.length !== 3) return 0;
    return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10)).getTime();
}

function renderMyHistory() {
    const tbody = document.getElementById("my-history-matrix-body");
    const kpiEl = document.getElementById("my-history-kpi");
    if (!tbody || !kpiEl) return;

    const activities = ["HỌP", "SINH HOẠT", "VIỆC CHUNG"];
    const historyData = (dashboardData && dashboardData.myHistory) || {};

    // 1. Render 3 thẻ tổng số buổi ở trên cùng
    kpiEl.innerHTML = activities.map(act => {
        const list = historyData[act] || [];
        const present = list.filter(r => r.present).length;
        return `
            <div class="kpi-box">
                <div class="kpi-box-title">${act}</div>
                <div class="kpi-box-val">${present}/${list.length}</div>
            </div>
        `;
    }).join("");

    // 2. Gom tất cả các ngày từ 3 mảng vào 1 bảng đối chiếu duy nhất
    const dateMap = {}; // { "22/11/2026": { date, dayOfWeek, status: { "HỌP": true/false, ... } } }

    activities.forEach(act => {
        const list = historyData[act] || [];
        list.forEach(item => {
            if (!dateMap[item.date]) {
                dateMap[item.date] = {
                    date: item.date,
                    dayOfWeek: item.dayOfWeek,
                    status: {}
                };
            }
            if (!dateMap[item.date].dayOfWeek && item.dayOfWeek) {
                dateMap[item.date].dayOfWeek = item.dayOfWeek;
            }
            dateMap[item.date].status[act] = item.present;
        });
    });

    // Sắp xếp ngày mới nhất lên đầu
    const sortedRows = Object.values(dateMap).sort(
        (a, b) => parseVnDateToTimestamp(b.date) - parseVnDateToTimestamp(a.date)
    );

    if (sortedRows.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" style="padding: 28px 12px; color: var(--muted); font-size: 13px;">
                    Chưa có dữ liệu điểm danh nào
                </td>
            </tr>
        `;
        return;
    }

    const renderCell = (val) => {
        if (val === true) return `<span class="mx-badge mx-present" title="Có mặt">✓</span>`;
        if (val === false) return `<span class="mx-badge mx-absent" title="Vắng mặt">✕</span>`;
        return `<span class="mx-none" title="Không có hoạt động">—</span>`;
    };

    tbody.innerHTML = sortedRows.map(row => `
        <tr>
            <td class="cell-date">
                <div class="cell-date-main">${row.date}</div>
                <div class="cell-date-sub">${formatDayViFull(row.dayOfWeek)}</div>
            </td>
            <td>${renderCell(row.status["HỌP"])}</td>
            <td>${renderCell(row.status["SINH HOẠT"])}</td>
            <td>${renderCell(row.status["VIỆC CHUNG"])}</td>
        </tr>
    `).join("");
}

/* ================= TRANG 3: THÔNG TIN CÁ NHÂN (XEM & SỬA) ================= */
function renderProfilePage() {
    const u = currentUser;
    const defaultLevel = u.level || (u.role === "admin" ? "Quản trị viên" : "Thành viên");
    const defaultPos = u.position || (u.role === "admin" ? "Quản trị hệ thống" : "Chưa cập nhật");

    // Hero & Chế độ Xem
    document.getElementById("prof-hero-avatar").innerHTML = renderAvatarHTML(u.avatar, u.fullName);
    document.getElementById("prof-hero-level").textContent = defaultLevel;
    document.getElementById("prof-hero-fullname").textContent = u.fullName;
    document.getElementById("prof-hero-position").textContent = defaultPos;

    document.getElementById("v-prof-username").textContent = "@" + u.username;
    document.getElementById("v-prof-fullname").textContent = u.fullName || "—";
    document.getElementById("v-prof-patronday").textContent = u.patronDay || "Chưa cập nhật";
    document.getElementById("v-prof-gender").textContent = u.gender || "—";
    document.getElementById("v-prof-dob").textContent = u.dob || "Chưa cập nhật";
    document.getElementById("v-prof-phone").textContent = u.phone || "Chưa cập nhật";
    document.getElementById("v-prof-level").textContent = defaultLevel;
    document.getElementById("v-prof-position").textContent = defaultPos;

    // Form Chế độ Sửa
    document.getElementById("prof-fullname").value = u.fullName || "";
    document.getElementById("prof-patronday").value = u.patronDay || "";
    document.getElementById("prof-gender").value = u.gender || "Nam";
    document.getElementById("prof-dob").value = u.dob || "";
    document.getElementById("prof-phone").value = u.phone || "";
    document.getElementById("prof-password").value = "";
    document.getElementById("prof-avatar-b64").value = "";
    document.getElementById("prof-avatar-file").value = "";
}

function toggleProfileEdit(isEditing) {
    document.getElementById("profile-view-box").style.display = isEditing ? "none" : "block";
    document.getElementById("profile-edit-box").style.display = isEditing ? "block" : "none";
    if (!isEditing) renderProfilePage();
}

async function saveMyProfile() {
    const payload = {
        action: "updateProfile",
        requesterId: currentUser.id,
        profile: {
            fullName: document.getElementById("prof-fullname").value.trim(),
            patronDay: document.getElementById("prof-patronday").value.trim(),
            gender: document.getElementById("prof-gender").value,
            dob: document.getElementById("prof-dob").value.trim(),
            phone: document.getElementById("prof-phone").value.trim(),
            password: document.getElementById("prof-password").value.trim(),
            avatarBase64: document.getElementById("prof-avatar-b64").value
        }
    };
    showToast("Đang lưu hồ sơ...", "loading", 0);
    const res = await callApi(payload);
    if (res.success) {
        showToast(res.message, "success");
        toggleProfileEdit(false);
        refreshDashboard(false);
    } else {
        showToast(res.message, "error");
    }
}

/* ================= BỘ CẮT ẢNH ĐẠI DIỆN THỦ CÔNG (CROPPER) ================= */
let cropState = {
    img: null,
    targetHiddenId: "",
    targetFileInput: null,
    baseScale: 1,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    isDragging: false,
    startX: 0,
    startY: 0
};

function previewAvatarFile(input, hiddenInputId) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const stageSize = 260;
            // Tỷ lệ tối thiểu để ảnh phủ kín khung vuông 260x260
            const baseScale = Math.max(stageSize / img.width, stageSize / img.height);

            cropState = {
                img: img,
                targetHiddenId: hiddenInputId,
                targetFileInput: input,
                baseScale: baseScale,
                zoom: 1,
                offsetX: 0,
                offsetY: 0,
                isDragging: false,
                startX: 0,
                startY: 0
            };

            document.getElementById("crop-zoom").value = "1";
            document.getElementById("crop-modal").classList.add("open");
            drawCropCanvas();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function clampCropOffsets() {
    const stageSize = 260;
    const scale = cropState.baseScale * cropState.zoom;
    const drawnW = cropState.img.width * scale;
    const drawnH = cropState.img.height * scale;

    const maxOffsetX = Math.max(0, (drawnW - stageSize) / 2);
    const maxOffsetY = Math.max(0, (drawnH - stageSize) / 2);

    cropState.offsetX = Math.min(maxOffsetX, Math.max(-maxOffsetX, cropState.offsetX));
    cropState.offsetY = Math.min(maxOffsetY, Math.max(-maxOffsetY, cropState.offsetY));
}

function drawCropCanvas() {
    if (!cropState.img) return;
    clampCropOffsets();

    const canvas = document.getElementById("crop-canvas");
    const ctx = canvas.getContext("2d");
    const stageSize = 260;
    const scale = cropState.baseScale * cropState.zoom;
    const drawnW = cropState.img.width * scale;
    const drawnH = cropState.img.height * scale;

    const x = (stageSize - drawnW) / 2 + cropState.offsetX;
    const y = (stageSize - drawnH) / 2 + cropState.offsetY;

    ctx.clearRect(0, 0, stageSize, stageSize);
    ctx.drawImage(cropState.img, x, y, drawnW, drawnH);
}

function updateCropZoom(val) {
    cropState.zoom = parseFloat(val) || 1;
    drawCropCanvas();
}

function closeCropModal() {
    document.getElementById("crop-modal").classList.remove("open");
    if (cropState.targetFileInput && !document.getElementById(cropState.targetHiddenId).value) {
        cropState.targetFileInput.value = "";
    }
}

function confirmCropAvatar() {
    if (!cropState.img) return;

    // Xuất ảnh đã cắt ở độ phân giải 300x300 sắc nét (~25KB)
    const outCanvas = document.createElement("canvas");
    const outSize = 300;
    outCanvas.width = outSize;
    outCanvas.height = outSize;
    const outCtx = outCanvas.getContext("2d");

    const ratio = outSize / 260;
    const scale = cropState.baseScale * cropState.zoom * ratio;
    const drawnW = cropState.img.width * scale;
    const drawnH = cropState.img.height * scale;
    const x = (outSize - drawnW) / 2 + cropState.offsetX * ratio;
    const y = (outSize - drawnH) / 2 + cropState.offsetY * ratio;

    outCtx.fillStyle = "#ffffff";
    outCtx.fillRect(0, 0, outSize, outSize);
    outCtx.drawImage(cropState.img, x, y, drawnW, drawnH);

    document.getElementById(cropState.targetHiddenId).value = outCanvas.toDataURL("image/jpeg", 0.82);
    document.getElementById("crop-modal").classList.remove("open");
    showToast("Đã cắt ảnh đại diện! Nhấn Lưu để cập nhật.", "success", 2200);
}

// Gắn sự kiện kéo chuột & vuốt cảm ứng cho khung cắt ảnh
window.addEventListener("DOMContentLoaded", () => {
    const stage = document.getElementById("crop-stage");
    if (!stage) return;

    const startDrag = (clientX, clientY) => {
        cropState.isDragging = true;
        cropState.startX = clientX - cropState.offsetX;
        cropState.startY = clientY - cropState.offsetY;
    };

    const moveDrag = (clientX, clientY) => {
        if (!cropState.isDragging) return;
        cropState.offsetX = clientX - cropState.startX;
        cropState.offsetY = clientY - cropState.startY;
        drawCropCanvas();
    };

    const endDrag = () => { cropState.isDragging = false; };

    stage.addEventListener("mousedown", e => startDrag(e.clientX, e.clientY));
    window.addEventListener("mousemove", e => moveDrag(e.clientX, e.clientY));
    window.addEventListener("mouseup", endDrag);

    stage.addEventListener("touchstart", e => {
        if (e.touches.length === 1) startDrag(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    stage.addEventListener("touchmove", e => {
        if (e.touches.length === 1) {
            e.preventDefault();
            moveDrag(e.touches[0].clientX, e.touches[0].clientY);
        }
    }, { passive: false });
    stage.addEventListener("touchend", endDrag);
});

/* ================= TRANG 4: QUÉT QR & ĐIỂM DANH THỦ CÔNG ================= */
function switchAttendSubMode(mode) {
    attendSubMode = mode;
    document.getElementById("subtab-qr-btn").classList.toggle("active", mode === "qr");
    document.getElementById("subtab-manual-btn").classList.toggle("active", mode === "manual");
    document.getElementById("attend-qr-box").style.display = (mode === "qr") ? "block" : "none";
    document.getElementById("attend-manual-box").style.display = (mode === "manual") ? "block" : "none";

    if (mode === "qr") startCamera();
    else {
        stopCamera();
        renderAttendanceList();
    }
}

function onActivityChange() {
    renderAttendanceList();
}

function renderAttendanceList() {
    if (!dashboardData) return;
    const act = document.getElementById("activity-select").value;
    const todayMap = dashboardData.todayAttendance[act] || {};
    const attendableMembers = (dashboardData.members || []).filter(m => m.role !== "admin");
    const kw = document.getElementById("attend-search").value.toLowerCase().trim();

    let checkedCount = 0;
    attendableMembers.forEach(m => { if (todayMap[m.id]) checkedCount++; });
    document.getElementById("attend-counter").textContent = `${checkedCount}/${attendableMembers.length}`;

    const filtered = attendableMembers.filter(m =>
        m.fullName.toLowerCase().includes(kw)
    );

    document.getElementById("attendance-user-list").innerHTML = filtered.map(m => {
        const isChecked = Boolean(todayMap[m.id]);
        return `
            <div class="user-item ${isChecked ? 'checked' : ''}">
                <div style="display: flex; align-items: center; gap: 11px;">
                    <div class="avatar-sm">${renderAvatarHTML(m.avatar, m.fullName)}</div>
                    <div>
                        <div style="font-size: 14px; font-weight: 600;">${m.fullName}</div>
                        <div style="font-size: 11.5px; color: var(--muted);">${m.level || 'Thành viên'} • ${m.position || 'Chưa có chức vụ'}</div>
                    </div>
                </div>
                <input type="checkbox" class="custom-check" ${isChecked ? 'checked' : ''} onchange="submitCheckIn('${m.id}', this.checked)">
            </div>
        `;
    }).join("");
}

async function submitCheckIn(targetId, isChecked) {
    const act = document.getElementById("activity-select").value;
    if (dashboardData && dashboardData.todayAttendance[act]) {
        dashboardData.todayAttendance[act][targetId] = isChecked;
        renderAttendanceList();
    }

    try {
        const res = await callApi({
            action: "checkIn",
            requesterId: currentUser.id,
            activityType: act,
            targetId: targetId,
            checked: isChecked
        });
        if (!res.success) {
            showToast(res.message, "error");
        }
    } catch (e) {
        showToast("Lỗi mạng khi lưu điểm danh!", "error");
    }
}

/* ================= LÕI CAMERA QUÉT QR ================= */
function playBeep() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!sharedAudioCtx) sharedAudioCtx = new AudioCtx();
        if (sharedAudioCtx.state === 'suspended') sharedAudioCtx.resume();
        const now = sharedAudioCtx.currentTime;
        const osc = sharedAudioCtx.createOscillator();
        const gain = sharedAudioCtx.createGain();
        osc.frequency.setValueAtTime(1050, now);
        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.14);
        osc.connect(gain); gain.connect(sharedAudioCtx.destination);
        osc.start(now); osc.stop(now + 0.14);
    } catch (e) { }
    if (navigator.vibrate) navigator.vibrate(90);
}

async function startCamera() {
    const video = document.getElementById("camera-video");
    try {
        stopCamera();
        videoStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        video.srcObject = videoStream;
        await video.play();
        startScanLoop();
    } catch (err) {
        showToast("Không mở được camera. Hãy cấp quyền hoặc bấm Bật lại Camera!", "error", 3500);
    }
}

function stopCamera() {
    if (scanLoopId) cancelAnimationFrame(scanLoopId);
    if (videoStream) {
        videoStream.getTracks().forEach(t => t.stop());
        videoStream = null;
    }
}

function startScanLoop() {
    const video = document.getElementById("camera-video");
    const canvas = document.getElementById("scan-canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let lastTime = 0;

    async function tick(ts) {
        scanLoopId = requestAnimationFrame(tick);
        if (isProcessingScan || video.readyState !== video.HAVE_ENOUGH_DATA) return;
        if (ts - lastTime < 50) return;
        lastTime = ts;

        const vw = video.videoWidth, vh = video.videoHeight;
        if (!vw || !vh) return;

        const crop = Math.floor(Math.min(vw, vh) * 0.65);
        const sx = Math.floor((vw - crop) / 2);
        const sy = Math.floor((vh - crop) / 2);
        const size = Math.min(crop, 450);
        canvas.width = size; canvas.height = size;
        ctx.drawImage(video, sx, sy, crop, crop, 0, 0, size, size);

        let codeText = null;
        if (nativeDetector) {
            try {
                const barcodes = await nativeDetector.detect(canvas);
                if (barcodes.length > 0) codeText = barcodes[0].rawValue;
            } catch (e) { }
        }
        if (!codeText && typeof jsQR !== "undefined") {
            const imgData = ctx.getImageData(0, 0, size, size);
            const qr = jsQR(imgData.data, size, size, { inversionAttempts: "attemptBoth" });
            if (qr && qr.data) codeText = qr.data;
        }

        if (codeText) {
            if (codeText === lastCandidate) {
                candidateStreak++;
                if (candidateStreak >= 2) {
                    candidateStreak = 0;
                    lastCandidate = "";
                    handleScannedQR(codeText.trim());
                }
            } else {
                lastCandidate = codeText;
                candidateStreak = 1;
            }
        } else {
            candidateStreak = 0;
        }
    }
    scanLoopId = requestAnimationFrame(tick);
}

function renderScanResultCard(member, statusType, statusLabel) {
    const card = document.getElementById("scan-result-card");
    if (!card) return;

    const nowTime = new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

    if (!member) {
        card.className = "scan-result-card invalid";
        card.innerHTML = `
            <div class="scan-card-body">
                <div class="avatar-lg" style="width:54px; height:54px; font-size:20px;">!</div>
                <div>
                    <span class="badge-role">Không hợp lệ • ${nowTime}</span>
                    <div style="font-size: 15.5px; font-weight: 700;">${statusLabel}</div>
                    <div style="font-size: 12px; opacity: 0.9; margin-top: 2px;">Vui lòng kiểm tra lại mã QR</div>
                </div>
            </div>
        `;
        return;
    }

    card.className = `scan-result-card ${statusType === "duplicate" ? "duplicate" : ""}`;
    card.innerHTML = `
        <div class="scan-card-status">
            <span>${statusLabel}</span>
            <span>${nowTime}</span>
        </div>
        <div class="scan-card-body">
            <div class="avatar-lg" style="width:58px; height:58px; font-size:22px;">
                ${renderAvatarHTML(member.avatar, member.fullName)}
            </div>
            <div style="min-width: 0; flex: 1;">
                <span class="badge-role">${member.level || "Thành viên"}</span>
                <div style="font-size: 16.5px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    ${member.fullName}
                </div>
                <div style="font-size: 12.5px; opacity: 0.92; margin-top: 2px;">
                    ${member.position || "Chưa cập nhật chức vụ"}
                </div>
            </div>
        </div>
    `;
}

function handleScannedQR(scannedId) {
    if (isProcessingScan || !dashboardData) return;
    isProcessingScan = true;

    const frame = document.getElementById("zaloFrame");
    frame.classList.add("detected");
    setTimeout(() => frame.classList.remove("detected"), 350);

    const act = document.getElementById("activity-select").value;
    const member = (dashboardData.members || []).find(m => m.id.toLowerCase() === scannedId.toLowerCase());

    if (!member) {
        playBeep();
        renderScanResultCard(null, "invalid", "Mã QR không hợp lệ");
        setTimeout(() => { isProcessingScan = false; }, 1300);
        return;
    }

    if (member.role === "admin") {
        playBeep();
        renderScanResultCard(member, "duplicate", "Tài khoản Admin — Không cần điểm danh");
        setTimeout(() => { isProcessingScan = false; }, 1300);
        return;
    }

    const alreadyChecked = Boolean(dashboardData.todayAttendance[act]?.[member.id]);
    if (alreadyChecked) {
        renderScanResultCard(member, "duplicate", `⚠ Đã điểm danh ${act} trước đó`);
        setTimeout(() => { isProcessingScan = false; }, 1200);
        return;
    }

    playBeep();
    renderScanResultCard(member, "success", `✓ Điểm danh ${act} thành công`);
    submitCheckIn(member.id, true);
    setTimeout(() => { isProcessingScan = false; }, 1300);
}

/* ================= TRANG 5: THỐNG KÊ TOÀN ĐOÀN ================= */
function buildAttendanceMatrixHTML(historyByAct) {
    const activities = ["HỌP", "SINH HOẠT", "VIỆC CHUNG"];
    const dateMap = {};

    activities.forEach(act => {
        const list = historyByAct[act] || [];
        list.forEach(item => {
            if (!dateMap[item.date]) {
                dateMap[item.date] = {
                    date: item.date,
                    dayOfWeek: item.dayOfWeek || item.day || "",
                    status: {}
                };
            }
            if (!dateMap[item.date].dayOfWeek && (item.dayOfWeek || item.day)) {
                dateMap[item.date].dayOfWeek = item.dayOfWeek || item.day;
            }
            dateMap[item.date].status[act] = item.present;
        });
    });

    const sortedRows = Object.values(dateMap).sort(
        (a, b) => parseVnDateToTimestamp(b.date) - parseVnDateToTimestamp(a.date)
    );

    if (sortedRows.length === 0) {
        return `
            <tr>
                <td colspan="4" style="padding: 28px 12px; color: var(--muted); font-size: 13px;">
                    Chưa có dữ liệu điểm danh nào
                </td>
            </tr>
        `;
    }

    const renderCell = (val) => {
        if (val === true) return `<span class="mx-badge mx-present" title="Có mặt">✓</span>`;
        if (val === false) return `<span class="mx-badge mx-absent" title="Vắng mặt">✕</span>`;
        return `<span class="mx-none" title="Không có hoạt động">—</span>`;
    };

    return sortedRows.map(row => `
        <tr>
            <td class="cell-date">
                <div class="cell-date-main">${row.date}</div>
                <div class="cell-date-sub">${formatDayViFull(row.dayOfWeek)}</div>
            </td>
            <td>${renderCell(row.status["HỌP"])}</td>
            <td>${renderCell(row.status["SINH HOẠT"])}</td>
            <td>${renderCell(row.status["VIỆC CHUNG"])}</td>
        </tr>
    `).join("");
}

function renderAllStats() {
    if (!dashboardData) return;
    const kw = document.getElementById("stats-search").value.toLowerCase().trim();
    const summary = dashboardData.allHistorySummary || {};
    const activities = ["HỌP", "SINH HOẠT", "VIỆC CHUNG"];

    // Lập bản đồ tra cứu nhanh theo từng thành viên (loại bỏ admin)
    const memberMap = {};
    (dashboardData.members || []).forEach(m => {
        if (m.role === "admin") return;
        memberMap[m.id] = {
            id: m.id,
            fullName: m.fullName,
            level: m.level || "Thành viên",
            position: m.position || "",
            avatar: m.avatar || "",
            stats: {
                "HỌP": { present: 0, total: 0, records: [] },
                "SINH HOẠT": { present: 0, total: 0, records: [] },
                "VIỆC CHUNG": { present: 0, total: 0, records: [] }
            }
        };
    });

    activities.forEach(act => {
        (summary[act] || []).forEach(item => {
            if (memberMap[item.id]) {
                memberMap[item.id].stats[act] = {
                    present: item.presentCount,
                    total: item.totalSessions,
                    records: item.recent || []
                };
            }
        });
    });

    const filtered = Object.values(memberMap).filter(m =>
        m.fullName.toLowerCase().includes(kw)
    );

    document.getElementById("all-stats-list").innerHTML = filtered.map(m => `
        <div class="stats-member-card" onclick="openMemberStatsModal('${m.id}')">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px;">
                <div style="display: flex; align-items: center; gap: 11px; min-width: 0;">
                    <div class="avatar-sm">${renderAvatarHTML(m.avatar, m.fullName)}</div>
                    <div style="min-width: 0;">
                        <div style="font-size: 14.5px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${m.fullName}</div>
                        <div style="font-size: 12px; color: var(--muted);">${m.level}${m.position ? ' • ' + m.position : ''}</div>
                    </div>
                </div>
                <span style="color: var(--muted); font-size: 16px; flex-shrink: 0;">›</span>
            </div>

            <div class="stats-badges-row">
                <div class="stat-pill-item">
                    Họp
                    <strong>${m.stats["HỌP"].present}/${m.stats["HỌP"].total} buổi</strong>
                </div>
                <div class="stat-pill-item">
                    Sinh hoạt
                    <strong>${m.stats["SINH HOẠT"].present}/${m.stats["SINH HOẠT"].total} buổi</strong>
                </div>
                <div class="stat-pill-item">
                    Việc chung
                    <strong>${m.stats["VIỆC CHUNG"].present}/${m.stats["VIỆC CHUNG"].total} buổi</strong>
                </div>
            </div>
        </div>
    `).join("");
}

function openMemberStatsModal(memberId) {
    if (!dashboardData) return;
    const member = (dashboardData.members || []).find(m => m.id === memberId);
    if (!member) return;

    const activities = ["HỌP", "SINH HOẠT", "VIỆC CHUNG"];
    const summary = dashboardData.allHistorySummary || {};
    const historyByAct = {};

    document.getElementById("ms-avatar").innerHTML = renderAvatarHTML(member.avatar, member.fullName);
    document.getElementById("ms-fullname").textContent = member.fullName;
    document.getElementById("ms-sub").textContent = `${member.level || "Thành viên"}${member.position ? " • " + member.position : ""}`;

    document.getElementById("ms-kpi-grid").innerHTML = activities.map(act => {
        const found = (summary[act] || []).find(x => x.id === memberId);
        const present = found ? found.presentCount : 0;
        const total = found ? found.totalSessions : 0;
        historyByAct[act] = found ? (found.recent || []) : [];
        return `
            <div class="kpi-box">
                <div class="kpi-box-title">${act}</div>
                <div class="kpi-box-val">${present}/${total}</div>
            </div>
        `;
    }).join("");

    document.getElementById("ms-matrix-body").innerHTML = buildAttendanceMatrixHTML(historyByAct);
    document.getElementById("member-stats-modal").classList.add("open");
}

function closeMemberStatsModal() {
    document.getElementById("member-stats-modal").classList.remove("open");
}

/* ================= TRANG 6: QUẢN TRỊ TÀI KHOẢN (XEM TRƯỚC -> SỬA SAU) ================= */
function getNextSequentialHtId() {
    const members = (dashboardData && dashboardData.members) || [];
    const usedNumbers = new Set();

    members.forEach(m => {
        const match = String(m.id || "").trim().toUpperCase().match(/^HT(\d+)$/);
        if (match) {
            usedNumbers.add(parseInt(match[1], 10));
        }
    });

    let nextNum = 1;
    while (usedNumbers.has(nextNum)) {
        nextNum++;
    }

    return "HT" + String(nextNum).padStart(2, "0");
}

function renderAdminUsers() {
    if (!dashboardData) return;
    const kw = document.getElementById("admin-search").value.toLowerCase().trim();
    const members = (dashboardData.members || []).filter(m =>
        m.fullName.toLowerCase().includes(kw) || m.username.toLowerCase().includes(kw)
    );

    document.getElementById("admin-user-list").innerHTML = members.map(m => `
        <div class="user-item" onclick='openUserModal(${JSON.stringify(m).replace(/'/g, "&#39;")})' style="cursor: pointer;">
            <div style="display: flex; align-items: center; gap: 11px;">
                <div class="avatar-sm">${renderAvatarHTML(m.avatar, m.fullName)}</div>
                <div>
                    <div style="font-size: 14px; font-weight: 600;">${m.fullName}</div>
                    <div style="font-size: 11.5px; color: var(--muted);">@${m.username} • ${m.level || 'Thành viên'} • ${m.position || 'Chưa có CV'}</div>
                </div>
            </div>
            <span class="status-tag" style="background: var(--primary-light); color: var(--primary); text-transform: uppercase;">${m.role}</span>
        </div>
    `).join("");
}

function openUserModal(user) {
    selectedAdminUser = user;
    const isNew = !user;

    document.getElementById("adm-is-new").value = isNew ? "1" : "0";
    document.getElementById("adm-id").value = isNew ? getNextSequentialHtId() : user.id;

    if (isNew) {
        // Nếu bấm "+ Thêm", mở thẳng Form tạo mới
        document.getElementById("modal-title").textContent = "Thêm thành viên mới";
        document.getElementById("adm-view-mode").style.display = "none";
        document.getElementById("adm-edit-mode").style.display = "block";
        fillAdminEditForm(null);
    } else {
        // Nếu bấm vào 1 thành viên có sẵn, mở Chế độ Xem chi tiết trước
        document.getElementById("modal-title").textContent = "Chi tiết thành viên";
        document.getElementById("adm-view-mode").style.display = "block";
        document.getElementById("adm-edit-mode").style.display = "none";

        document.getElementById("adm-v-avatar").innerHTML = renderAvatarHTML(user.avatar, user.fullName);
        document.getElementById("adm-v-role").textContent = (user.role || "user").toUpperCase();
        document.getElementById("adm-v-fullname").textContent = user.fullName;
        document.getElementById("adm-v-sub").textContent = `${user.level || "Thành viên"} • ${user.position || "Chưa cập nhật chức vụ"}`;

        document.getElementById("adm-v-username").textContent = "@" + user.username;
        document.getElementById("adm-v-patronday").textContent = user.patronDay || "Chưa cập nhật";
        document.getElementById("adm-v-gender").textContent = user.gender || "—";
        document.getElementById("adm-v-dob").textContent = user.dob || "Chưa cập nhật";
        document.getElementById("adm-v-phone").textContent = user.phone || "Chưa cập nhật";
        document.getElementById("adm-v-level").textContent = user.level || "—";
        document.getElementById("adm-v-position").textContent = user.position || "Chưa cập nhật";

        // Ẩn nút Xóa nếu đang xem chính tài khoản Admin đang đăng nhập
        document.getElementById("btn-delete-user").style.display =
            (user.id.toLowerCase() === currentUser.id.toLowerCase()) ? "none" : "inline-flex";
    }

    document.getElementById("user-modal").classList.add("open");
}

function fillAdminEditForm(user) {
    const isNew = !user;

    // Ẩn hoàn toàn trường Tên đăng nhập khi sửa; chỉ hiện khi tạo mới
    document.getElementById("adm-username-group").style.display = isNew ? "block" : "none";
    document.getElementById("adm-username").value = user ? user.username : "";

    // Đổi nhãn mật khẩu phù hợp giữa Tạo mới và Chỉnh sửa
    document.getElementById("adm-password-label").textContent = isNew
        ? "Mật khẩu khởi tạo (Mặc định 123456 nếu để trống)"
        : "Đổi mật khẩu mới (Để trống nếu giữ nguyên)";

    document.getElementById("adm-password").value = "";
    document.getElementById("adm-fullname").value = user ? user.fullName : "";
    document.getElementById("adm-patronday").value = user ? (user.patronDay || "") : "";
    document.getElementById("adm-gender").value = user ? user.gender : "Nam";
    document.getElementById("adm-dob").value = user ? user.dob : "";
    document.getElementById("adm-phone").value = user ? user.phone : "";
    document.getElementById("adm-level").value = user ? user.level : "Dự Trưởng";
    document.getElementById("adm-position").value = user ? user.position : "";
    document.getElementById("adm-role").value = user ? user.role : "user";
    document.getElementById("adm-avatar-b64").value = "";
    document.getElementById("adm-avatar-file").value = "";
}

function switchAdminModalToEdit() {
    document.getElementById("modal-title").textContent = "Chỉnh sửa thành viên";
    document.getElementById("adm-view-mode").style.display = "none";
    document.getElementById("adm-edit-mode").style.display = "block";
    fillAdminEditForm(selectedAdminUser);
}

function cancelAdminEdit() {
    if (!selectedAdminUser) {
        closeUserModal();
    } else {
        openUserModal(selectedAdminUser);
    }
}

function closeUserModal() {
    document.getElementById("user-modal").classList.remove("open");
    selectedAdminUser = null;
}

async function saveUserByAdmin() {
    const isNew = document.getElementById("adm-is-new").value === "1";
    const userData = {
        id: isNew ? getNextSequentialHtId() : document.getElementById("adm-id").value.trim(),
        username: document.getElementById("adm-username").value.trim(),
        password: document.getElementById("adm-password").value.trim(),
        fullName: document.getElementById("adm-fullname").value.trim(),
        patronDay: document.getElementById("adm-patronday").value.trim(),
        gender: document.getElementById("adm-gender").value,
        dob: document.getElementById("adm-dob").value.trim(),
        phone: document.getElementById("adm-phone").value.trim(),
        level: document.getElementById("adm-level").value,
        position: document.getElementById("adm-position").value.trim(),
        role: document.getElementById("adm-role").value,
        avatarBase64: document.getElementById("adm-avatar-b64").value
    };

    showToast("Đang lưu & đồng bộ 4 tab...", "loading", 0);
    const res = await callApi({
        action: "adminSaveUser",
        requesterId: currentUser.id,
        isNew: isNew,
        userData: userData
    });

    if (res.success) {
        closeUserModal();
        showToast(res.message, "success");
        refreshDashboard(false);
    } else {
        showToast(res.message, "error");
    }
}

async function deleteUserByAdmin() {
    const targetId = document.getElementById("adm-id").value.trim();
    const targetName = selectedAdminUser ? selectedAdminUser.fullName : "";
    if (!confirm(`Bạn có chắc chắn muốn xóa thành viên [${targetName}] khỏi toàn bộ hệ thống không?`)) return;

    showToast("Đang xóa thành viên...", "loading", 0);
    const res = await callApi({
        action: "adminDeleteUser",
        requesterId: currentUser.id,
        targetId: targetId
    });

    if (res.success) {
        closeUserModal();
        showToast(res.message, "success");
        refreshDashboard(false);
    } else {
        showToast(res.message, "error");
    }
}