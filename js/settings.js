  const rowEmail = document.createElement("div");
  rowEmail.className = "settings-row";
  rowEmail.innerHTML = `
    <div class="settings-row-info">
      <div class="settings-row-label">Email</div>
      <div class="settings-row-desc">${escapeHtml(state.user.email || "")}</div>
    </div>
  `;
  const changeEmailBtn = document.createElement("button");
  changeEmailBtn.className = "btn btn-ghost";
  changeEmailBtn.textContent = "Change";
  changeEmailBtn.addEventListener("click", () => {
    const v = prompt("New email:");
    if (!v) return;
    updateEmail(v)
      .then(() => toast("Check your inbox to confirm", "info"))
      .catch((e) => toast(e.message, "error"));
  });
  rowEmail.appendChild(changeEmailBtn);
  s.appendChild(rowEmail);
