const state = {
  officers: [],
  statistics: null,
  leaderboard: [],
  selectedOfficer: null,
};

const pages = {
  dashboard: {
    elementId: "dashboardPage",
    title: "Tableau de bord",
    subtitle: "Vue générale du département",
  },

  officers: {
    elementId: "officersPage",
    title: "Policiers",
    subtitle: "Gestion des policiers HMPD",
  },

  leaderboard: {
    elementId: "leaderboardPage",
    title: "Classement",
    subtitle: "Classement par nombre de points",
  },
};

const elements = {
  navButtons:
    document.querySelectorAll(".nav-button"),

  pages:
    document.querySelectorAll(".page"),

  pageTitle:
    document.querySelector("#pageTitle"),

  pageSubtitle:
    document.querySelector("#pageSubtitle"),

  refreshButton:
    document.querySelector("#refreshButton"),

  notification:
    document.querySelector("#notification"),

  officerCount:
    document.querySelector("#officerCount"),

  totalPoints:
    document.querySelector("#totalPoints"),

  averagePoints:
    document.querySelector("#averagePoints"),

  bestOfficer:
    document.querySelector("#bestOfficer"),

  dashboardLeaderboard:
    document.querySelector(
      "#dashboardLeaderboard"
    ),

  gradeStatistics:
    document.querySelector(
      "#gradeStatistics"
    ),

  officersTableBody:
    document.querySelector(
      "#officersTableBody"
    ),

  officerSearch:
    document.querySelector(
      "#officerSearch"
    ),

  fullLeaderboard:
    document.querySelector(
      "#fullLeaderboard"
    ),

  profileModal:
    document.querySelector(
      "#profileModal"
    ),

  profileContent:
    document.querySelector(
      "#profileContent"
    ),

  closeProfileButton:
    document.querySelector(
      "#closeProfileButton"
    ),

  pointsModal:
    document.querySelector(
      "#pointsModal"
    ),

  pointsForm:
    document.querySelector(
      "#pointsForm"
    ),

  pointsModalTitle:
    document.querySelector(
      "#pointsModalTitle"
    ),

  pointsOfficerName:
    document.querySelector(
      "#pointsOfficerName"
    ),

  pointsAction:
    document.querySelector(
      "#pointsAction"
    ),

  pointsUserId:
    document.querySelector(
      "#pointsUserId"
    ),

  pointsAmount:
    document.querySelector(
      "#pointsAmount"
    ),

  pointsReason:
    document.querySelector(
      "#pointsReason"
    ),

  pointsFormError:
    document.querySelector(
      "#pointsFormError"
    ),

  submitPointsButton:
    document.querySelector(
      "#submitPointsButton"
    ),

  closePointsButton:
    document.querySelector(
      "#closePointsButton"
    ),

  cancelPointsButton:
    document.querySelector(
      "#cancelPointsButton"
    ),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) {
    return "Inconnue";
  }

  const normalizedValue =
    value.includes("T")
      ? value
      : `${value.replace(" ", "T")}Z`;

  const date =
    new Date(normalizedValue);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(
    "fr-FR",
    {
      dateStyle: "medium",
      timeStyle: "short",
    }
  ).format(date);
}

function getDisplayName(officer) {
  return (
    officer?.display_name ||
    officer?.discord?.displayName ||
    officer?.username ||
    "Membre inconnu"
  );
}

function getUsername(officer) {
  return (
    officer?.username ||
    officer?.discord?.username ||
    officer?.user_id ||
    "inconnu"
  );
}

function getAvatar(officer) {
  return (
    officer?.avatar_url ||
    officer?.discord?.avatarUrl ||
    "https://cdn.discordapp.com/embed/avatars/0.png"
  );
}

async function requestJson(
  url,
  options = {}
) {
  const response =
    await fetch(url, options);

  const data =
    await response
      .json()
      .catch(() => null);

  if (!response.ok || !data?.success) {
    throw new Error(
      data?.message ||
      "Une erreur est survenue."
    );
  }

  return data;
}

function showNotification(
  message,
  success = false
) {
  elements.notification.textContent =
    message;

  elements.notification.classList.remove(
    "hidden",
    "success"
  );

  if (success) {
    elements.notification.classList.add(
      "success"
    );
  }

  window.setTimeout(() => {
    elements.notification.classList.add(
      "hidden"
    );
  }, 5000);
}

function setPage(pageName) {
  const page =
    pages[pageName];

  if (!page) {
    return;
  }

  for (const button of elements.navButtons) {
    button.classList.toggle(
      "active",
      button.dataset.page === pageName
    );
  }

  for (const pageElement of elements.pages) {
    pageElement.classList.toggle(
      "active",
      pageElement.id === page.elementId
    );
  }

  elements.pageTitle.textContent =
    page.title;

  elements.pageSubtitle.textContent =
    page.subtitle;
}

function getPosition(index) {
  return (
    ["🥇", "🥈", "🥉"][index] ||
    `${index + 1}.`
  );
}

function createOfficerIdentity(officer) {
  const displayName =
    getDisplayName(officer);

  return `
    <div class="officer-identity">
      <img
        class="officer-avatar"
        src="${escapeHtml(getAvatar(officer))}"
        alt="Avatar"
        onerror="
          this.onerror = null;
          this.src =
            'https://cdn.discordapp.com/embed/avatars/0.png';
        "
      >

      <div class="officer-name">
        <strong>
          ${escapeHtml(displayName)}
        </strong>

        <span>
          @${escapeHtml(getUsername(officer))}
        </span>
      </div>
    </div>
  `;
}

function createRankingItem(officer, index) {
  return `
    <div class="ranking-item">
      <div class="ranking-position">
        ${getPosition(index)}
      </div>

      ${createOfficerIdentity(officer)}

      <div class="ranking-points">
        ${Number(officer.points)} pts
      </div>
    </div>
  `;
}

function renderStatistics() {
  const statistics =
    state.statistics;

  if (!statistics) {
    return;
  }

  elements.officerCount.textContent =
    statistics.officers ?? 0;

  elements.totalPoints.textContent =
    statistics.totalPoints ?? 0;

  elements.averagePoints.textContent =
    statistics.averagePoints ?? 0;

  elements.bestOfficer.textContent =
    statistics.highestOfficer
      ? `${getDisplayName(
          statistics.highestOfficer
        )} (${statistics.highestOfficer.points})`
      : "Aucun";
}

function renderGradeStatistics() {
  const statistics =
    state.statistics?.gradeStatistics || {};

  const entries =
    Object.entries(statistics)
      .sort(
        (first, second) =>
          second[1] - first[1]
      );

  elements.gradeStatistics.innerHTML =
    entries.length
      ? entries
          .map(
            ([grade, total]) => `
              <div class="grade-item">
                <span>
                  ${escapeHtml(grade)}
                </span>

                <strong>
                  ${Number(total)}
                </strong>
              </div>
            `
          )
          .join("")
      : `
        <div class="empty-state">
          Aucun grade enregistré.
        </div>
      `;
}

function renderLeaderboards() {
  const topFive =
    state.leaderboard.slice(0, 5);

  elements.dashboardLeaderboard.innerHTML =
    topFive.length
      ? topFive
          .map(createRankingItem)
          .join("")
      : `
        <div class="empty-state">
          Aucun policier enregistré.
        </div>
      `;

  elements.fullLeaderboard.innerHTML =
    state.leaderboard.length
      ? state.leaderboard
          .map(createRankingItem)
          .join("")
      : `
        <div class="empty-state">
          Aucun policier enregistré.
        </div>
      `;
}

function renderOfficers(
  officers = state.officers
) {
  if (!officers.length) {
    elements.officersTableBody.innerHTML = `
      <tr>
        <td colspan="6">
          <div class="empty-state">
            Aucun policier trouvé.
          </div>
        </td>
      </tr>
    `;

    return;
  }

  elements.officersTableBody.innerHTML =
    officers
      .map(
        (officer, index) => `
          <tr>
            <td>${index + 1}</td>

            <td>
              ${createOfficerIdentity(officer)}
            </td>

            <td>
              <span class="grade-badge">
                ${escapeHtml(officer.grade)}
              </span>
            </td>

            <td>
              <strong>
                ${Number(officer.points)}
              </strong>
            </td>

            <td>
              ${escapeHtml(
                formatDate(officer.updated_at)
              )}
            </td>

            <td>
              <button
                class="profile-button"
                data-user-id="${escapeHtml(
                  officer.user_id
                )}"
                type="button"
              >
                👤 Profil
              </button>
            </td>
          </tr>
        `
      )
      .join("");
}

async function loadData() {
  elements.refreshButton.disabled = true;
  elements.refreshButton.textContent =
    "⏳ Chargement...";

  try {
    const [
      officersResponse,
      statisticsResponse,
      leaderboardResponse,
    ] = await Promise.all([
      requestJson("/api/officers"),
      requestJson("/api/statistics"),
      requestJson(
        "/api/dashboard/leaderboard?limit=50"
      ),
    ]);

    state.officers =
      officersResponse.officers || [];

    state.statistics =
      statisticsResponse.statistics || null;

    state.leaderboard =
      leaderboardResponse.leaderboard || [];

    renderStatistics();
    renderGradeStatistics();
    renderLeaderboards();
    renderOfficers();
  } catch (error) {
    console.error(error);
    showNotification(error.message);
  } finally {
    elements.refreshButton.disabled = false;
    elements.refreshButton.textContent =
      "🔄 Actualiser";
  }
}

function calculateProgress(officer) {
  if (!officer.next_grade) {
    return 100;
  }

  const remaining =
    Number(
      officer.points_until_next_grade
    );

  const currentPoints =
    Number(officer.points);

  const targetPoints =
    currentPoints + remaining;

  if (targetPoints <= 0) {
    return 0;
  }

  return Math.min(
    Math.max(
      Math.round(
        (currentPoints / targetPoints) *
          100
      ),
      0
    ),
    100
  );
}

async function openProfile(userId) {
  elements.profileModal.classList.remove(
    "hidden"
  );

  elements.profileContent.innerHTML = `
    <div class="empty-state">
      Chargement du profil...
    </div>
  `;

  try {
    const [
      profileResponse,
      historyResponse,
    ] = await Promise.all([
      requestJson(
        `/api/officers/${encodeURIComponent(
          userId
        )}`
      ),

      requestJson(
        `/api/officers/${encodeURIComponent(
          userId
        )}/history?limit=15`
      ),
    ]);

    state.selectedOfficer =
      profileResponse.officer;

    renderProfile(
      profileResponse.officer,
      historyResponse.history || []
    );
  } catch (error) {
    elements.profileContent.innerHTML = `
      <div class="empty-state">
        ${escapeHtml(error.message)}
      </div>
    `;
  }
}

function renderProfile(officer, history) {
  const progress =
    calculateProgress(officer);

  const statusClass =
    officer.is_in_server
      ? ""
      : "offline";

  const statusText =
    officer.is_in_server
      ? "Dans le serveur"
      : "Hors du serveur";

  const historyHtml =
    history.length
      ? history
          .map((entry) => {
            const isAddition =
              entry.action === "add";

            return `
              <article
                class="history-item ${
                  isAddition
                    ? "add"
                    : "remove"
                }"
              >
                <div class="history-header">
                  <strong>
                    ${
                      isAddition
                        ? "➕ Ajout"
                        : "➖ Retrait"
                    }
                    de ${entry.amount} point(s)
                  </strong>

                  <span>
                    ${escapeHtml(
                      formatDate(
                        entry.created_at
                      )
                    )}
                  </span>
                </div>

                <p>
                  ⭐ ${entry.old_points}
                  ➜
                  ${entry.new_points}
                </p>

                <p>
                  📝 ${escapeHtml(
                    entry.reason
                  )}
                </p>

                <p>
                  👮 Responsable :
                  ${escapeHtml(
                    entry.moderator_id
                  )}
                </p>
              </article>
            `;
          })
          .join("")
      : `
        <div class="empty-state">
          Aucun historique.
        </div>
      `;

  elements.profileContent.innerHTML = `
    <section class="profile-header">
      <img
        class="profile-avatar"
        src="${escapeHtml(
          getAvatar(officer)
        )}"
        alt="Avatar"
      >

      <div>
        <h2>
          ${escapeHtml(
            getDisplayName(officer)
          )}
        </h2>

        <p>
          @${escapeHtml(
            getUsername(officer)
          )}
        </p>

        <span
          class="profile-status ${statusClass}"
        >
          ${statusText}
        </span>
      </div>
    </section>

    <section class="profile-stats">
      <article class="profile-stat">
        <span>Grade actuel</span>
        <strong>
          ${escapeHtml(officer.grade)}
        </strong>
      </article>

      <article class="profile-stat">
        <span>Points</span>
        <strong>
          ${Number(officer.points)}
        </strong>
      </article>

      <article class="profile-stat">
        <span>Prochain grade</span>
        <strong>
          ${
            officer.next_grade
              ? escapeHtml(
                  officer.next_grade
                )
              : "Grade maximum"
          }
        </strong>
      </article>
    </section>

    <section class="progress-section">
      <div class="progress-header">
        <span>
          Progression
        </span>

        <span>
          ${
            officer.next_grade
              ? `${officer.points_until_next_grade} point(s) restant(s)`
              : "Grade maximum atteint"
          }
        </span>
      </div>

      <div class="progress-bar">
        <div
          class="progress-value"
          style="width: ${progress}%"
        ></div>
      </div>
    </section>

    <section class="profile-actions">
      <button
        class="button"
        type="button"
        data-points-action="add"
        data-user-id="${escapeHtml(
          officer.user_id
        )}"
      >
        ➕ Ajouter des points
      </button>

      <button
        class="button danger"
        type="button"
        data-points-action="remove"
        data-user-id="${escapeHtml(
          officer.user_id
        )}"
      >
        ➖ Retirer des points
      </button>

      <button
        class="button secondary"
        type="button"
        data-refresh-profile="${escapeHtml(
          officer.user_id
        )}"
      >
        🔄 Actualiser
      </button>
    </section>

    <section class="profile-history">
      <h3>Historique récent</h3>
      ${historyHtml}
    </section>
  `;
}

function closeProfile() {
  elements.profileModal.classList.add(
    "hidden"
  );

  state.selectedOfficer = null;
}

function openPointsForm(
  action,
  userId
) {
  const officer =
    state.selectedOfficer;

  if (!officer) {
    return;
  }

  elements.pointsAction.value =
    action;

  elements.pointsUserId.value =
    userId;

  elements.pointsAmount.value = "";
  elements.pointsReason.value = "";

  elements.pointsFormError.classList.add(
    "hidden"
  );

  elements.pointsModalTitle.textContent =
    action === "add"
      ? "Ajouter des points"
      : "Retirer des points";

  elements.pointsOfficerName.textContent =
    getDisplayName(officer);

  elements.submitPointsButton.textContent =
    action === "add"
      ? "Confirmer l’ajout"
      : "Confirmer le retrait";

  elements.submitPointsButton.classList.toggle(
    "danger",
    action === "remove"
  );

  elements.pointsModal.classList.remove(
    "hidden"
  );

  elements.pointsAmount.focus();
}

function closePointsForm() {
  elements.pointsModal.classList.add(
    "hidden"
  );

  elements.pointsForm.reset();

  elements.pointsFormError.classList.add(
    "hidden"
  );
}

async function submitPoints(event) {
  event.preventDefault();

  const action =
    elements.pointsAction.value;

  const userId =
    elements.pointsUserId.value;

  const amount =
    Number(elements.pointsAmount.value);

  const reason =
    elements.pointsReason.value.trim();

  if (
    !Number.isInteger(amount) ||
    amount <= 0
  ) {
    elements.pointsFormError.textContent =
      "Le nombre de points est invalide.";

    elements.pointsFormError.classList.remove(
      "hidden"
    );

    return;
  }

  if (reason.length < 3) {
    elements.pointsFormError.textContent =
      "La raison doit contenir au moins 3 caractères.";

    elements.pointsFormError.classList.remove(
      "hidden"
    );

    return;
  }

  elements.submitPointsButton.disabled = true;
  elements.submitPointsButton.textContent =
    "⏳ Enregistrement...";

  try {
    const response =
      await requestJson(
        `/api/officers/${encodeURIComponent(
          userId
        )}/points`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            action,
            amount,
            reason,
          }),
        }
      );

    closePointsForm();

    showNotification(
      response.message,
      true
    );

    await loadData();
    await openProfile(userId);
  } catch (error) {
    console.error(error);

    elements.pointsFormError.textContent =
      error.message;

    elements.pointsFormError.classList.remove(
      "hidden"
    );
  } finally {
    elements.submitPointsButton.disabled =
      false;

    elements.submitPointsButton.textContent =
      "Confirmer";
  }
}

function filterOfficers() {
  const search =
    elements.officerSearch.value
      .trim()
      .toLowerCase();

  if (!search) {
    renderOfficers();
    return;
  }

  const filtered =
    state.officers.filter(
      (officer) => {
        const values = [
          officer.user_id,
          officer.grade,
          getDisplayName(officer),
          getUsername(officer),
        ];

        return values.some((value) =>
          String(value || "")
            .toLowerCase()
            .includes(search)
        );
      }
    );

  renderOfficers(filtered);
}

for (const button of elements.navButtons) {
  button.addEventListener(
    "click",
    () => {
      setPage(button.dataset.page);
    }
  );
}

elements.refreshButton.addEventListener(
  "click",
  loadData
);

elements.officerSearch.addEventListener(
  "input",
  filterOfficers
);

elements.officersTableBody.addEventListener(
  "click",
  (event) => {
    const button =
      event.target.closest(
        ".profile-button"
      );

    if (button) {
      openProfile(
        button.dataset.userId
      );
    }
  }
);

elements.profileContent.addEventListener(
  "click",
  (event) => {
    const pointsButton =
      event.target.closest(
        "[data-points-action]"
      );

    if (pointsButton) {
      openPointsForm(
        pointsButton.dataset.pointsAction,
        pointsButton.dataset.userId
      );

      return;
    }

    const refreshButton =
      event.target.closest(
        "[data-refresh-profile]"
      );

    if (refreshButton) {
      openProfile(
        refreshButton.dataset.refreshProfile
      );
    }
  }
);

elements.pointsForm.addEventListener(
  "submit",
  submitPoints
);

for (
  const quickButton of
  document.querySelectorAll(
    ".quick-points button"
  )
) {
  quickButton.addEventListener(
    "click",
    () => {
      elements.pointsAmount.value =
        quickButton.dataset.amount;
    }
  );
}

elements.closeProfileButton.addEventListener(
  "click",
  closeProfile
);

elements.closePointsButton.addEventListener(
  "click",
  closePointsForm
);

elements.cancelPointsButton.addEventListener(
  "click",
  closePointsForm
);

document
  .querySelector("[data-close-profile]")
  .addEventListener(
    "click",
    closeProfile
  );

document
  .querySelector("[data-close-points]")
  .addEventListener(
    "click",
    closePointsForm
  );

document.addEventListener(
  "keydown",
  (event) => {
    if (event.key !== "Escape") {
      return;
    }

    if (
      !elements.pointsModal.classList.contains(
        "hidden"
      )
    ) {
      closePointsForm();
      return;
    }

    if (
      !elements.profileModal.classList.contains(
        "hidden"
      )
    ) {
      closeProfile();
    }
  }
);

loadData();