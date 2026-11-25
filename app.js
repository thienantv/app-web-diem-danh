const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzaGKpNJQwWKMqPMucbhvBmtdq-obaUlD8-ezo-avvzIleVAtjPvp5RL03AbNjEK1v6/exec";

let currentUser = null;
let dashboardData = null;
let currentMyHistoryAct = "HỌP";
let currentStatsAct = "HỌP";
let attendSubMode = "qr";

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

// Đăng ký Service Worker cho PWA
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => { });
}

/* ================= GỌI API (TRÁNH CORS BẰNG TEXT/PLAIN) ================= */
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

/* ================= ĐĂNG NHẬP & PHIÊN LÀM VIỆC ================= */
window.addEventListener("DOMContentLoaded", () => {
    const saved = localStorage.getItem("dd_user");
    if (saved) {
        currentUser = JSON.parse(saved);
        document.getElementById("login-screen").style.display = "none";
        applyRoleUI();
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
        applyRoleUI();
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

function applyRoleUI() {
    const role = currentUser.role;
    document.querySelectorAll(".role-manager").forEach(el => {
        el.style.display = (role === "manager" || role === "admin") ? "flex" : "none";
    });
    document.querySelectorAll(".role-admin").forEach(el => {
        el.style.display = (role === "admin") ? "flex" : "none";
    });
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
        applyRoleUI();

        document.getElementById("header-date").textContent = "Hôm nay: " + res.today;
        renderProfileAndQR();
        renderMyHistory();

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

/* ================= CHUYỂN TAB CHÍNH ================= */
function switchMainTab(tabId, title, btn) {
    document.querySelectorAll(".tab-view").forEach(v => v.classList.remove("active"));
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    document.getElementById(tabId).classList.add("active");
    btn.classList.add("active");
    document.getElementById("header-title").textContent = title;

    if (tabId === "view-attendance" && attendSubMode === "qr") {
        startCamera();
    } else {
        stopCamera();
    }
}

/* ================= TAB 1: THẺ QR & HỒ SƠ CÁ NHÂN ================= */
function renderAvatarHTML(url, name) {
    if (url && url.trim() !== "") {
        return `<img src="${url}" alt="avatar" onerror="this.style.display='none'; this.parentNode.textContent='${getInitials(name)}'">`;
    }
    return getInitials(name);
}

function getInitials(name) {
    return name ? name.trim().split(" ").pop().charAt(0).toUpperCase() : "?";
}

// 1. Trong hàm renderProfileAndQR(): ẩn thẻ lịch sử cá nhân nếu là admin
function renderProfileAndQR() {
    const u = currentUser;
    document.getElementById("card-avatar").innerHTML = renderAvatarHTML(u.avatar, u.fullName);
    document.getElementById("card-level").textContent = u.level || (u.role === "admin" ? "Quản trị viên" : "Thành viên");
    document.getElementById("card-fullname").textContent = u.fullName;
    document.getElementById("card-position").textContent = u.position || (u.role === "admin" ? "Quản trị hệ thống" : "Chưa cập nhật chức vụ");
    document.getElementById("card-id").textContent = "MÃ ĐỊNH DANH: " + u.id;

    // Ẩn lịch sử điểm danh cá nhân nếu tài khoản là Admin
    const historyCard = document.getElementById("my-history-card");
    if (historyCard) {
        historyCard.style.display = (u.role === "admin") ? "none" : "block";
    }

    // Vẽ mã QR từ ID
    const qrBox = document.getElementById("my-qrcode");
    qrBox.innerHTML = "";
    new QRCode(qrBox, {
        text: u.id,
        width: 165,
        height: 165,
        colorDark: "#002060",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
    });

    // Đổ dữ liệu vào form cá nhân
    document.getElementById("prof-fullname").value = u.fullName || "";
    document.getElementById("prof-gender").value = u.gender || "Nam";
    document.getElementById("prof-dob").value = u.dob || "";
    document.getElementById("prof-phone").value = u.phone || "";
    document.getElementById("prof-level").value = u.level || "";
    document.getElementById("prof-position").value = u.position || "";
    document.getElementById("prof-password").value = "";
    document.getElementById("prof-avatar-b64").value = "";
}

function switchMyHistoryTab(actName, btn) {
    currentMyHistoryAct = actName;
    btn.parentNode.querySelectorAll(".pill-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    renderMyHistory();
}

function renderMyHistory() {
    const listEl = document.getElementById("my-history-list");
    const records = (dashboardData && dashboardData.myHistory[currentMyHistoryAct]) || [];
    if (records.length === 0) {
        listEl.innerHTML = `<div style="text-align:center; padding: 18px; color: var(--muted); font-size: 13px;">Chưa có dữ liệu điểm danh mục này</div>`;
        return;
    }
    listEl.innerHTML = records.map(r => `
        <div class="history-row">
            <div>
                <strong>${r.date}</strong> <span style="color: var(--muted); font-size: 12px;">(${r.dayOfWeek})</span>
            </div>
            <span class="status-tag ${r.present ? 'status-present' : 'status-absent'}">
                ${r.present ? 'Có mặt' : 'Vắng'}
            </span>
        </div>
    `).join("");
}

async function saveMyProfile() {
    const payload = {
        action: "updateProfile",
        requesterId: currentUser.id,
        profile: {
            fullName: document.getElementById("prof-fullname").value.trim(),
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
        refreshDashboard(false);
    } else {
        showToast(res.message, "error");
    }
}

// Nén ảnh trước khi gửi lên Drive để tốc độ tải lên cực nhanh (~20KB)
function previewAvatarFile(input, hiddenInputId) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement("canvas");
            const maxSize = 240;
            let w = img.width, h = img.height;
            if (w > h) { if (w > maxSize) { h *= maxSize / w; w = maxSize; } }
            else { if (h > maxSize) { w *= maxSize / h; h = maxSize; } }
            canvas.width = w; canvas.height = h;
            canvas.getContext("2d").drawImage(img, 0, 0, w, h);
            document.getElementById(hiddenInputId).value = canvas.toDataURL("image/jpeg", 0.75);
            showToast("Đã chọn ảnh đại diện!", "success", 1500);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

/* ================= TAB 2: QUÉT QR & ĐIỂM DANH THỦ CÔNG ================= */
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

// 2. Trong hàm renderAttendanceList(): loại admin khỏi danh sách & bộ đếm sĩ số
function renderAttendanceList() {
    if (!dashboardData) return;
    const act = document.getElementById("activity-select").value;
    const todayMap = dashboardData.todayAttendance[act] || {};
    // Chỉ lấy những thành viên không phải admin
    const attendableMembers = (dashboardData.members || []).filter(m => m.role !== "admin");
    const kw = document.getElementById("attend-search").value.toLowerCase().trim();

    let checkedCount = 0;
    attendableMembers.forEach(m => { if (todayMap[m.id]) checkedCount++; });
    document.getElementById("attend-counter").textContent = `${checkedCount}/${attendableMembers.length}`;

    const filtered = attendableMembers.filter(m =>
        m.fullName.toLowerCase().includes(kw) || m.id.toLowerCase().includes(kw)
    );

    document.getElementById("attendance-user-list").innerHTML = filtered.map(m => {
        const isChecked = Boolean(todayMap[m.id]);
        return `
            <div class="user-item ${isChecked ? 'checked' : ''}">
                <div style="display: flex; align-items: center; gap: 11px;">
                    <div class="avatar-sm">${renderAvatarHTML(m.avatar, m.fullName)}</div>
                    <div>
                        <div style="font-size: 14px; font-weight: 600;">${m.fullName}</div>
                        <div style="font-size: 11.5px; color: var(--muted);">${m.id} • ${m.level || 'Thành viên'}</div>
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

/* ================= LÕI CAMERA QUÉT QR TỐC ĐỘ CAO ================= */
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
                    ${member.position || "Chưa cập nhật chức vụ"} • <strong style="letter-spacing:0.5px;">${member.id}</strong>
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
        renderScanResultCard(null, "invalid", `Mã [${scannedId}] không tồn tại`);
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

/* ================= TAB 3: THỐNG KÊ TOÀN ĐOÀN ================= */
function switchStatsActivity(act, btn) {
    currentStatsAct = act;
    btn.parentNode.querySelectorAll(".pill-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    renderAllStats();
}

function renderAllStats() {
    if (!dashboardData) return;
    const list = dashboardData.allHistorySummary[currentStatsAct] || [];
    const kw = document.getElementById("stats-search").value.toLowerCase().trim();
    const filtered = list.filter(item =>
        item.fullName.toLowerCase().includes(kw) || item.id.toLowerCase().includes(kw)
    );

    document.getElementById("all-stats-list").innerHTML = filtered.map(item => `
        <div class="card" style="padding: 12px 14px; margin-bottom: 10px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div class="avatar-sm">${renderAvatarHTML(item.avatar, item.fullName)}</div>
                    <div>
                        <div style="font-size: 14px; font-weight: 600;">${item.fullName}</div>
                        <div style="font-size: 11.5px; color: var(--muted);">${item.level || 'Thành viên'}</div>
                    </div>
                </div>
                <span class="status-tag status-present">${item.presentCount}/${item.totalSessions} buổi</span>
            </div>
            ${item.recent.length > 0 ? `
                <div style="display: flex; flex-wrap: wrap; gap: 5px; margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--border);">
                    ${item.recent.map(d => `
                        <span style="font-size: 11px; padding: 2px 7px; border-radius: 6px; background: ${d.present ? 'var(--success-bg)' : 'var(--error-bg)'}; color: ${d.present ? 'var(--success)' : 'var(--error)'};">
                            ${d.date.slice(0, 5)}: ${d.present ? '✓' : '✕'}
                        </span>
                    `).join("")}
                </div>
            ` : ''}
        </div>
    `).join("");
}

/* ================= TAB 4: QUẢN TRỊ TÀI KHOẢN (CHỈ ADMIN) ================= */
function renderAdminUsers() {
    if (!dashboardData) return;
    const kw = document.getElementById("admin-search").value.toLowerCase().trim();
    const members = (dashboardData.members || []).filter(m =>
        m.fullName.toLowerCase().includes(kw) || m.id.toLowerCase().includes(kw) || m.username.toLowerCase().includes(kw)
    );

    document.getElementById("admin-user-list").innerHTML = members.map(m => `
        <div class="user-item" onclick='openUserModal(${JSON.stringify(m).replace(/'/g, "&#39;")})' style="cursor: pointer;">
            <div style="display: flex; align-items: center; gap: 11px;">
                <div class="avatar-sm">${renderAvatarHTML(m.avatar, m.fullName)}</div>
                <div>
                    <div style="font-size: 14px; font-weight: 600;">${m.fullName}</div>
                    <div style="font-size: 11.5px; color: var(--muted);">${m.id} • ${m.level} • ${m.position || 'Chưa có CV'}</div>
                </div>
            </div>
            <span class="status-tag" style="background: var(--primary-light); color: var(--primary); text-transform: uppercase;">${m.role}</span>
        </div>
    `).join("");
}

function openUserModal(user) {
    const isNew = !user;
    document.getElementById("adm-is-new").value = isNew ? "1" : "0";
    document.getElementById("modal-title").textContent = isNew ? "Thêm thành viên mới" : "Sửa thông tin thành viên";
    document.getElementById("btn-delete-user").style.display = isNew ? "none" : "inline-flex";

    const idInput = document.getElementById("adm-id");
    const userInput = document.getElementById("adm-username");
    idInput.disabled = !isNew;
    userInput.disabled = !isNew;

    idInput.value = user ? user.id : "";
    userInput.value = user ? user.username : "";
    document.getElementById("adm-password").value = "";
    document.getElementById("adm-fullname").value = user ? user.fullName : "";
    document.getElementById("adm-gender").value = user ? user.gender : "Nam";
    document.getElementById("adm-dob").value = user ? user.dob : "";
    document.getElementById("adm-phone").value = user ? user.phone : "";
    document.getElementById("adm-level").value = user ? user.level : "Dự Trưởng";
    document.getElementById("adm-position").value = user ? user.position : "";
    document.getElementById("adm-role").value = user ? user.role : "user";
    document.getElementById("adm-avatar-b64").value = "";
    document.getElementById("adm-avatar-file").value = "";

    document.getElementById("user-modal").classList.add("open");
}

function closeUserModal() {
    document.getElementById("user-modal").classList.remove("open");
}

async function saveUserByAdmin() {
    const isNew = document.getElementById("adm-is-new").value === "1";
    const userData = {
        id: document.getElementById("adm-id").value.trim(),
        username: document.getElementById("adm-username").value.trim(),
        password: document.getElementById("adm-password").value.trim(),
        fullName: document.getElementById("adm-fullname").value.trim(),
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
    if (!confirm(`Bạn có chắc chắn muốn xóa thành viên [${targetId}] khỏi toàn bộ hệ thống không?`)) return;

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