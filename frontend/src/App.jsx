import { useEffect, useMemo, useState } from "react";

import {
  loadWorksSanctioned,
  loadExpenditure,
  loadWorksCompleted,
} from "./readData";

/* =========================================================
   HELPERS
========================================================= */

function cleanWorkId(id) {
  if (!id) return "";

  const value = String(id).trim();

  /*
    Example:
    WS/MP18152/2024-2025/133703
  */

  const match = value.match(
    /^(WS\/MP\d+\/\d{4}-\d{4}\/\d+)/i
  );

  return match
    ? match[1].toUpperCase()
    : value.toUpperCase();
}

/* =========================================================
   NUMBER HELPER
========================================================= */

function toNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const cleaned = String(value)
    .replace(/₹/g, "")
    .replace(/,/g, "")
    .replace(/%/g, "")
    .trim();

  const number = Number(cleaned);

  return Number.isFinite(number) ? number : 0;
}

/* =========================================================
   RISK CALCULATION
========================================================= */

function calculateRisk(work) {
  let score = 0;
  const reasons = [];

  const spending = toNumber(
    work.spendingPercentage
  );

  const sanction = toNumber(
    work["Sanction Amount ( ₹ )"]
  );

  const disbursed = toNumber(
    work.totalDisbursed
  );

  const vendors = toNumber(
    work.vendorCount
  );

  const status = String(
    work["Work Status"] || ""
  ).toLowerCase();

  /* -----------------------------------------
     1. OVERSPENDING
  ----------------------------------------- */

  if (spending > 100) {
    score += 40;

    reasons.push(
      "Disbursed amount exceeds sanctioned amount"
    );
  }

  /* -----------------------------------------
     2. HIGH SPENDING BUT INCOMPLETE
  ----------------------------------------- */

  if (
    spending > 80 &&
    !work.completed
  ) {
    score += 25;

    reasons.push(
      "High spending but project is not completed"
    );
  }

  /* -----------------------------------------
     3. PARTIALLY COMPLETED
  ----------------------------------------- */

  if (
    status.includes("partially") &&
    !work.completed
  ) {
    score += 20;

    reasons.push(
      "Work is partially completed"
    );
  }

  /* -----------------------------------------
     4. PHYSICAL INSPECTION
  ----------------------------------------- */

  if (
    status.includes("physical inspection") &&
    !work.completed
  ) {
    score += 10;

    reasons.push(
      "Physical inspection pending"
    );
  }

  /* -----------------------------------------
     5. MULTIPLE VENDORS
  ----------------------------------------- */

  if (vendors >= 5) {
    score += 10;

    reasons.push(
      "Multiple vendors involved"
    );
  }

  /* -----------------------------------------
     6. VERY LARGE PROJECT
  ----------------------------------------- */

  if (sanction >= 10000000) {
    score += 15;

    reasons.push(
      "Very high sanctioned amount"
    );
  }

  /* -----------------------------------------
     7. COMPLETED BUT NO EXPENDITURE
  ----------------------------------------- */

  if (
    work.completed &&
    disbursed === 0
  ) {
    score += 15;

    reasons.push(
      "Completed work has no recorded expenditure amount"
    );
  }

  /* -----------------------------------------
     LIMIT SCORE
  ----------------------------------------- */

  score = Math.min(score, 100);

  /* -----------------------------------------
     RISK LEVEL

     0       = NO RISK
     1 - 19  = LOW
     20 - 49 = MEDIUM
     50+     = HIGH
  ----------------------------------------- */

  let level = "NO RISK";

  if (score >= 50) {
    level = "HIGH";
  } else if (score >= 20) {
    level = "MEDIUM";
  } else if (score > 0) {
    level = "LOW";
  }

  /* -----------------------------------------
     NO RISK MESSAGE
  ----------------------------------------- */

  if (score === 0) {
    reasons.push(
      "No major anomaly detected by current rules"
    );
  }

  return {
    score,
    level,
    reasons,
  };
}

/* =========================================================
   MAIN APP
========================================================= */

function App() {
  const [works, setWorks] = useState([]);

  const [loading, setLoading] =
    useState(true);

  const [search, setSearch] =
    useState("");

  const [stateFilter, setStateFilter] =
    useState("ALL");

  const [riskFilter, setRiskFilter] =
    useState("ALL");

  const [statusFilter, setStatusFilter] =
    useState("ALL");

  const [selectedWork, setSelectedWork] =
    useState(null);

  /* =======================================================
     LOAD DATA
  ======================================================= */

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);

        const sanctioned =
          await loadWorksSanctioned();

        const expenditure =
          await loadExpenditure();

        const completed =
          await loadWorksCompleted();

        console.log(
          "Sanctioned:",
          sanctioned.length
        );

        console.log(
          "Expenditure:",
          expenditure.length
        );

        console.log(
          "Completed:",
          completed.length
        );

        /* =================================================
           EXPENDITURE MAP
        ================================================= */

        const expenditureMap = {};

        expenditure.forEach((item) => {
          const id = cleanWorkId(
            item["Work ID"]
          );

          if (!id) return;

          if (!expenditureMap[id]) {
            expenditureMap[id] = {
              totalDisbursed: 0,
              vendors: [],
              payments: [],
            };
          }

          expenditureMap[id].totalDisbursed +=
            toNumber(
              item[
                "Fund Disbursed Amount ( ₹ )"
              ]
            );

          if (item["Vendor Name"]) {
            expenditureMap[id].vendors.push(
              String(
                item["Vendor Name"]
              ).trim()
            );
          }

          expenditureMap[id].payments.push(
            item
          );
        });

        /* =================================================
           COMPLETED MAP
        ================================================= */

        const completedMap = {};

        completed.forEach((item) => {
          const id = cleanWorkId(
            item["Work"]
          );

          if (!id) return;

          completedMap[id] = {
            ...item,
            cleanWorkId: id,
          };
        });

        /* =================================================
           COMBINE ALL DATA
        ================================================= */

        const combined =
          sanctioned.map((item) => {
            const id = cleanWorkId(
              item["Work ID"]
            );

            const expenditureInfo =
              expenditureMap[id];

            const completedInfo =
              completedMap[id];

            /* -----------------------------------------
               SANCTION AMOUNT
            ----------------------------------------- */

            const sanctionAmount =
              toNumber(
                item[
                  "Sanction Amount ( ₹ )"
                ]
              );

            /* -----------------------------------------
               EXPENDITURE AMOUNT
            ----------------------------------------- */

            const expenditureDisbursed =
              expenditureInfo
                ?.totalDisbursed || 0;

            /* -----------------------------------------
               COMPLETED FILE AMOUNT
            ----------------------------------------- */

            const completedDisbursed =
              completedInfo
                ? toNumber(
                    completedInfo[
                      "Amount Disbursed ( ₹ )"
                    ] ??
                      completedInfo[
                        "Amount Disbursed"
                      ] ??
                      completedInfo[
                        "Disbursed Amount ( ₹ )"
                      ] ??
                      completedInfo[
                        "Disbursed Amount"
                      ]
                  )
                : 0;

            /* -----------------------------------------
               EFFECTIVE DISBURSED
            ----------------------------------------- */

            let totalDisbursed = 0;

            if (
              expenditureDisbursed > 0
            ) {
              totalDisbursed =
                expenditureDisbursed;
            } else if (
              completedDisbursed > 0
            ) {
              totalDisbursed =
                completedDisbursed;
            }

            /* -----------------------------------------
               SPENDING %
            ----------------------------------------- */

            const spendingPercentage =
              sanctionAmount > 0
                ? (totalDisbursed /
                    sanctionAmount) *
                  100
                : 0;

            /* -----------------------------------------
               COMPLETION

               A project is completed when its
               Work ID exists in the completed file.
            ----------------------------------------- */

            const isCompleted =
              Boolean(completedInfo);

            /* -----------------------------------------
               WORK OBJECT
            ----------------------------------------- */

            const work = {
              ...item,

              cleanWorkId: id,

              /* Financial */
              totalDisbursed,
              expenditureDisbursed,
              completedDisbursed,
              spendingPercentage,

              /* Vendors */
              vendorCount:
                expenditureInfo
                  ? new Set(
                      expenditureInfo.vendors
                    ).size
                  : 0,

              /* Expenditure */
              expenditureRecords:
                expenditureInfo
                  ?.payments?.length || 0,

              /* Completion */
              completed: isCompleted,

              completionDate:
                completedInfo?.[
                  "Completion Date"
                ] || null,

              /* Original status */
              originalWorkStatus:
                item["Work Status"] || "",
            };

            /* -----------------------------------------
               RISK
            ----------------------------------------- */

            const risk =
              calculateRisk(work);

            work.riskScore =
              risk.score;

            work.riskLevel =
              risk.level;

            work.riskReasons =
              risk.reasons;

            return work;
          });

        /* =================================================
           DEBUG
        ================================================= */

        console.log(
          "Combined projects:",
          combined
        );

        console.log(
          "Completed projects:",
          combined.filter(
            (w) => w.completed
          ).length
        );

        console.log(
          "No risk projects:",
          combined.filter(
            (w) =>
              w.riskLevel ===
              "NO RISK"
          ).length
        );

        console.log(
          "Low risk projects:",
          combined.filter(
            (w) =>
              w.riskLevel ===
              "LOW"
          ).length
        );

        console.log(
          "Medium risk projects:",
          combined.filter(
            (w) =>
              w.riskLevel ===
              "MEDIUM"
          ).length
        );

        console.log(
          "High risk projects:",
          combined.filter(
            (w) =>
              w.riskLevel ===
              "HIGH"
          ).length
        );

        setWorks(combined);
      } catch (error) {
        console.error(
          "Error loading MPLADS data:",
          error
        );
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  /* =======================================================
     STATE FILTER OPTIONS
  ======================================================= */

  const states = useMemo(() => {
    const uniqueStates =
      Array.from(
        new Set(
          works
            .map(
              (work) =>
                work.State
            )
            .filter(Boolean)
        )
      ).sort();

    return [
      "ALL",
      ...uniqueStates,
    ];
  }, [works]);

  /* =======================================================
     RISK COUNTS
  ======================================================= */

  const noRisk =
    works.filter(
      (work) =>
        work.riskLevel ===
        "NO RISK"
    ).length;

  const lowRisk =
    works.filter(
      (work) =>
        work.riskLevel ===
        "LOW"
    ).length;

  const mediumRisk =
    works.filter(
      (work) =>
        work.riskLevel ===
        "MEDIUM"
    ).length;

  const highRisk =
    works.filter(
      (work) =>
        work.riskLevel ===
        "HIGH"
    ).length;

  /* =======================================================
     FILTERED WORKS
  ======================================================= */

  const filteredWorks =
    useMemo(() => {
      return works.filter(
        (work) => {
          const searchText =
            search
              .toLowerCase()
              .trim();

          /* -----------------------------------------
             SEARCH

             Search also checks AI reasons.
          ----------------------------------------- */

          const searchableReasons =
            (
              work.riskReasons ||
              []
            )
              .join(" ")
              .toLowerCase();

          const matchesSearch =
            !searchText ||
            String(
              work.cleanWorkId ||
                ""
            )
              .toLowerCase()
              .includes(searchText) ||
            String(
              work[
                "Work description"
              ] || ""
            )
              .toLowerCase()
              .includes(searchText) ||
            String(
              work[
                "Hon'ble Members of Parliament"
              ] || ""
            )
              .toLowerCase()
              .includes(searchText) ||
            String(
              work.Constituency ||
                ""
            )
              .toLowerCase()
              .includes(searchText) ||
            searchableReasons.includes(
              searchText
            );

          /* -----------------------------------------
             STATE
          ----------------------------------------- */

          const matchesState =
            stateFilter === "ALL" ||
            work.State ===
              stateFilter;

          /* -----------------------------------------
             RISK

             AI FLAGGED =
             HIGH + MEDIUM
          ----------------------------------------- */

          let matchesRisk = true;

          if (
            riskFilter ===
            "AI_FLAGGED"
          ) {
            matchesRisk =
              work.riskLevel ===
                "HIGH" ||
              work.riskLevel ===
                "MEDIUM";
          } else if (
            riskFilter !== "ALL"
          ) {
            matchesRisk =
              work.riskLevel ===
              riskFilter;
          }

          /* -----------------------------------------
             STATUS
          ----------------------------------------- */

          let matchesStatus = true;

          if (
            statusFilter ===
            "COMPLETED"
          ) {
            matchesStatus =
              work.completed;
          }

          if (
            statusFilter ===
            "ONGOING"
          ) {
            matchesStatus =
              !work.completed;
          }

          if (
            statusFilter ===
            "EXPENDITURE"
          ) {
            matchesStatus =
              work.totalDisbursed >
              0;
          }

          return (
            matchesSearch &&
            matchesState &&
            matchesRisk &&
            matchesStatus
          );
        }
      );
    }, [
      works,
      search,
      stateFilter,
      riskFilter,
      statusFilter,
    ]);

  /* =======================================================
     DASHBOARD STATISTICS
  ======================================================= */

  const totalSanctioned =
    works.length;

  const totalCompleted =
    works.filter(
      (work) =>
        work.completed
    ).length;

  const totalWithExpenditure =
    works.filter(
      (work) =>
        work.totalDisbursed >
        0
    ).length;

  const aiFlagged =
    highRisk +
    mediumRisk;

  const totalSanctionAmount =
    works.reduce(
      (sum, work) =>
        sum +
        toNumber(
          work[
            "Sanction Amount ( ₹ )"
          ]
        ),
      0
    );

  const totalDisbursed =
    works.reduce(
      (sum, work) =>
        sum +
        toNumber(
          work.totalDisbursed
        ),
      0
    );

  const completionPercentage =
    totalSanctioned > 0
      ? (
          (totalCompleted /
            totalSanctioned) *
          100
        ).toFixed(1)
      : "0.0";

  /* =======================================================
     FORMAT MONEY
  ======================================================= */

  function money(value) {
    return `₹${toNumber(
      value
    ).toLocaleString("en-IN")}`;
  }

  /* =======================================================
     LOADING
  ======================================================= */

  if (loading) {
    return (
      <div style={styles.loading}>
        <div
          style={
            styles.loadingSpinner
          }
        />

        <h2>
          Loading MPLADS data...
        </h2>

        <p>
          Combining sanctioned,
          expenditure and
          completed works.
        </p>
      </div>
    );
  }

  /* =======================================================
     DASHBOARD
  ======================================================= */

  return (
    <div style={styles.page}>

      {/* HEADER */}

      <header
        style={styles.header}
      >
        <div>
          <div
            style={styles.logo}
          >
            MPLADS
          </div>

          <h1
            style={styles.title}
          >
            AI Monitoring Dashboard
          </h1>

          <p
            style={styles.subtitle}
          >
            Monitor sanctioned works,
            expenditure, completion
            and potential anomalies.
          </p>
        </div>

        <div
          style={
            styles.headerBadge
          }
        >
          AI POWERED
        </div>
      </header>

      {/* SUMMARY CARDS */}

      <section
        style={styles.cards}
      >
        <StatCard
          title="Total Sanctioned"
          value={totalSanctioned.toLocaleString(
            "en-IN"
          )}
          subtitle="Works"
        />

        <StatCard
          title="Completed"
          value={totalCompleted.toLocaleString(
            "en-IN"
          )}
          subtitle={`${completionPercentage}% of works`}
        />

        <StatCard
          title="With Expenditure"
          value={totalWithExpenditure.toLocaleString(
            "en-IN"
          )}
          subtitle="Matched records"
        />

        <StatCard
          title="AI Review"
          value={aiFlagged.toLocaleString(
            "en-IN"
          )}
          subtitle="Projects requiring attention"
          danger
          onClick={() =>
            setRiskFilter(
              "AI_FLAGGED"
            )
          }
        />
      </section>

      {/* FINANCIAL / RISK CARDS */}

      <section
        style={
          styles.financialCards
        }
      >
        <FinanceCard
          title="Sanctioned Amount"
          value={money(
            totalSanctionAmount
          )}
        />

        <FinanceCard
          title="Total Disbursed"
          value={money(
            totalDisbursed
          )}
        />

        <FinanceCard
          title="High Risk"
          value={highRisk}
          color="#dc2626"
          onClick={() =>
            setRiskFilter("HIGH")
          }
        />

        <FinanceCard
          title="Medium Risk"
          value={mediumRisk}
          color="#d97706"
          onClick={() =>
            setRiskFilter("MEDIUM")
          }
        />

        <FinanceCard
          title="Low Risk"
          value={lowRisk}
          color="#16a34a"
          onClick={() =>
            setRiskFilter("LOW")
          }
        />

        <FinanceCard
          title="No Risk"
          value={noRisk}
          color="#6b7280"
          onClick={() =>
            setRiskFilter(
              "NO RISK"
            )
          }
        />
      </section>

      {/* RISK OVERVIEW */}

      <section
        style={styles.panel}
      >
        <div
          style={
            styles.panelHeader
          }
        >
          <div>
            <h2
              style={
                styles.panelTitle
              }
            >
              Risk Overview
            </h2>

            <p
              style={
                styles.panelSubtitle
              }
            >
              Current anomaly screening
            </p>
          </div>

          <strong>
            {works.length.toLocaleString(
              "en-IN"
            )}{" "}
            projects
          </strong>
        </div>

        {/* IMPORTANT:
            Entire bar contains all 4 categories.
        */}

        <div
          style={styles.riskBar}
        >
          {works.length > 0 && (
            <>
              {/* HIGH */}

              <div
                style={{
                  ...styles.riskHigh,
                  width: `${
                    (highRisk /
                      works.length) *
                    100
                  }%`,
                }}
              />

              {/* MEDIUM */}

              <div
                style={{
                  ...styles.riskMedium,
                  width: `${
                    (mediumRisk /
                      works.length) *
                    100
                  }%`,
                }}
              />

              {/* LOW */}

              <div
                style={{
                  ...styles.riskLow,
                  width: `${
                    (lowRisk /
                      works.length) *
                    100
                  }%`,
                }}
              />

              {/* NO RISK */}

              <div
                style={{
                  ...styles.riskNoRisk,
                  width: `${
                    (noRisk /
                      works.length) *
                    100
                  }%`,
                }}
              />
            </>
          )}
        </div>

        {/* LEGEND */}

        <div
          style={styles.legend}
        >
          <LegendItem
            color="#dc2626"
            label={`High: ${highRisk}`}
          />

          <LegendItem
            color="#f59e0b"
            label={`Medium: ${mediumRisk}`}
          />

          <LegendItem
            color="#16a34a"
            label={`Low: ${lowRisk}`}
          />

          <LegendItem
            color="#9ca3af"
            label={`No Risk: ${noRisk}`}
          />
        </div>
      </section>

      {/* FILTERS */}

      <section
        style={styles.panel}
      >
        <div
          style={
            styles.panelHeader
          }
        >
          <div>
            <h2
              style={
                styles.panelTitle
              }
            >
              Project Monitoring
            </h2>

            <p
              style={
                styles.panelSubtitle
              }
            >
              Search and filter MPLADS
              works
            </p>
          </div>

          <span
            style={
              styles.resultCount
            }
          >
            {filteredWorks.length}{" "}
            results
          </span>
        </div>

        <div
          style={styles.filters}
        >
          {/* SEARCH */}

          <input
            style={styles.search}
            placeholder="Search work ID, project, MP, constituency or AI anomaly..."
            value={search}
            onChange={(e) =>
              setSearch(
                e.target.value
              )
            }
          />

          {/* STATE */}

          <select
            style={styles.select}
            value={stateFilter}
            onChange={(e) =>
              setStateFilter(
                e.target.value
              )
            }
          >
            {states.map(
              (state) => (
                <option
                  key={state}
                  value={state}
                >
                  {state === "ALL"
                    ? "All States"
                    : state}
                </option>
              )
            )}
          </select>

          {/* RISK */}

          <select
            style={styles.select}
            value={riskFilter}
            onChange={(e) =>
              setRiskFilter(
                e.target.value
              )
            }
          >
            <option value="ALL">
              All Risk Levels
            </option>

            <option value="AI_FLAGGED">
              AI Flagged
            </option>

            <option value="HIGH">
              High Risk
            </option>

            <option value="MEDIUM">
              Medium Risk
            </option>

            <option value="LOW">
              Low Risk
            </option>

            <option value="NO RISK">
              No Risk
            </option>
          </select>

          {/* STATUS */}

          <select
            style={styles.select}
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(
                e.target.value
              )
            }
          >
            <option value="ALL">
              All Status
            </option>

            <option value="COMPLETED">
              Completed
            </option>

            <option value="ONGOING">
              Ongoing
            </option>

            <option value="EXPENDITURE">
              Has Expenditure
            </option>
          </select>
        </div>

        {/* ACTIVE AI FILTER MESSAGE */}

        {riskFilter ===
          "AI_FLAGGED" && (
          <div
            style={
              styles.aiFilterMessage
            }
          >
            <strong>
              AI Flagged Projects
            </strong>

            <span>
              Showing HIGH + MEDIUM
              risk projects
            </span>

            <button
              style={
                styles.clearFilterButton
              }
              onClick={() =>
                setRiskFilter(
                  "ALL"
                )
              }
            >
              Clear
            </button>
          </div>
        )}
      </section>

      {/* PROJECT TABLE */}

      <section
        style={styles.panel}
      >
        <div
          style={
            styles.tableWrapper
          }
        >
          <table
            style={styles.table}
          >
            <thead>
              <tr>
                <th>Project</th>
                <th>State</th>
                <th>Sanction</th>
                <th>Disbursed</th>
                <th>Spending</th>
                <th>Status</th>
                <th>AI Risk</th>
              </tr>
            </thead>

            <tbody>
              {filteredWorks
                .slice(0, 100)
                .map((work) => (
                  <tr
                    key={
                      work.cleanWorkId
                    }
                    style={
                      styles.tableRow
                    }
                    onClick={() =>
                      setSelectedWork(
                        work
                      )
                    }
                  >
                    {/* PROJECT */}

                    <td>
                      <div
                        style={
                          styles.projectName
                        }
                      >
                        {work[
                          "Work description"
                        ] ||
                          work.Work ||
                          "Unnamed project"}
                      </div>

                      <div
                        style={
                          styles.workId
                        }
                      >
                        {work.cleanWorkId ||
                          "No Work ID"}
                      </div>
                    </td>

                    {/* STATE */}

                    <td>
                      {work.State ||
                        "—"}
                    </td>

                    {/* SANCTION */}

                    <td>
                      {money(
                        work[
                          "Sanction Amount ( ₹ )"
                        ]
                      )}
                    </td>

                    {/* DISBURSED */}

                    <td>
                      {money(
                        work.totalDisbursed
                      )}
                    </td>

                    {/* SPENDING */}

                    <td>
                      <div
                        style={
                          styles.spendingCell
                        }
                      >
                        <div
                          style={
                            styles.progressTrack
                          }
                        >
                          <div
                            style={{
                              ...styles.progressFill,
                              width: `${
                                Math.min(
                                  work.spendingPercentage,
                                  100
                                )
                              }%`,
                              background:
                                work.spendingPercentage >
                                100
                                  ? "#dc2626"
                                  : "#4f46e5",
                            }}
                          />
                        </div>

                        <span>
                          {work.spendingPercentage.toFixed(
                            1
                          )}
                          %
                        </span>
                      </div>
                    </td>

                    {/* STATUS */}

                    <td>
                      <span
                        style={{
                          ...styles.statusBadge,
                          background:
                            work.completed
                              ? "#dcfce7"
                              : "#fef3c7",
                          color:
                            work.completed
                              ? "#166534"
                              : "#92400e",
                        }}
                      >
                        {work.completed
                          ? "Completed"
                          : work[
                              "Work Status"
                            ] ||
                            "Ongoing"}
                      </span>
                    </td>

                    {/* RISK */}

                    <td>
                      <RiskBadge
                        level={
                          work.riskLevel
                        }
                        score={
                          work.riskScore
                        }
                      />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {/* MORE THAN 100 */}

        {filteredWorks.length >
          100 && (
          <p
            style={
              styles.tableNote
            }
          >
            Showing first 100
            results. Use filters to
            narrow the results.
          </p>
        )}

        {/* NO RESULTS */}

        {filteredWorks.length ===
          0 && (
          <div
            style={
              styles.noResults
            }
          >
            No projects match your
            filters.
          </div>
        )}
      </section>

      {/* PROJECT DETAILS MODAL */}

      {selectedWork && (
        <div
          style={
            styles.modalOverlay
          }
          onClick={() =>
            setSelectedWork(null)
          }
        >
          <div
            style={styles.modal}
            onClick={(e) =>
              e.stopPropagation()
            }
          >
            {/* CLOSE */}

            <button
              style={
                styles.closeButton
              }
              onClick={() =>
                setSelectedWork(
                  null
                )
              }
            >
              ×
            </button>

            {/* RISK */}

            <div
              style={
                styles.modalRisk
              }
            >
              <RiskBadge
                level={
                  selectedWork.riskLevel
                }
                score={
                  selectedWork.riskScore
                }
              />
            </div>

            {/* TITLE */}

            <h2
              style={
                styles.modalTitle
              }
            >
              {selectedWork[
                "Work description"
              ] ||
                "Project Details"}
            </h2>

            {/* WORK ID */}

            <p
              style={
                styles.modalWorkId
              }
            >
              {selectedWork.cleanWorkId}
            </p>

            {/* PROJECT INFORMATION */}

            <div
              style={
                styles.detailGrid
              }
            >
              <Detail
                label="MP"
                value={
                  selectedWork[
                    "Hon'ble Members of Parliament"
                  ]
                }
              />

              <Detail
                label="State"
                value={
                  selectedWork.State
                }
              />

              <Detail
                label="Constituency"
                value={
                  selectedWork.Constituency
                }
              />

              <Detail
                label="Category"
                value={
                  selectedWork[
                    "Work category"
                  ]
                }
              />

              <Detail
                label="Sanction Amount"
                value={money(
                  selectedWork[
                    "Sanction Amount ( ₹ )"
                  ]
                )}
              />

              <Detail
                label="Total Disbursed"
                value={money(
                  selectedWork.totalDisbursed
                )}
              />

              <Detail
                label="Spending"
                value={`${selectedWork.spendingPercentage.toFixed(
                  1
                )}%`}
              />

              <Detail
                label="Vendors"
                value={
                  selectedWork.vendorCount
                }
              />

              <Detail
                label="Expenditure Records"
                value={
                  selectedWork.expenditureRecords
                }
              />

              <Detail
                label="Sanction Date"
                value={
                  selectedWork[
                    "Sanction Date"
                  ]
                }
              />

              <Detail
                label="Completion Date"
                value={
                  selectedWork.completionDate ||
                  "Not completed"
                }
              />

              <Detail
                label="Status"
                value={
                  selectedWork.completed
                    ? "Completed"
                    : selectedWork[
                        "Work Status"
                      ] ||
                      "Ongoing"
                }
              />

              <Detail
                label="Original Work Status"
                value={
                  selectedWork.originalWorkStatus ||
                  "—"
                }
              />
            </div>

            {/* AI ANALYSIS */}

            <div
              style={styles.aiBox}
            >
              <h3
                style={
                  styles.aiTitle
                }
              >
                AI Risk Analysis
              </h3>

              <div
                style={
                  styles.scoreRow
                }
              >
                <div>
                  <span
                    style={
                      styles.scoreLabel
                    }
                  >
                    Risk Score
                  </span>

                  <strong
                    style={
                      styles.score
                    }
                  >
                    {
                      selectedWork.riskScore
                    }
                    /100
                  </strong>
                </div>

                <RiskBadge
                  level={
                    selectedWork.riskLevel
                  }
                  score={
                    selectedWork.riskScore
                  }
                />
              </div>

              <h4
                style={
                  styles.reasonTitle
                }
              >
                {selectedWork.riskLevel ===
                "NO RISK"
                  ? "AI Assessment"
                  : "Why this project was flagged"}
              </h4>

              <ul
                style={
                  styles.reasonList
                }
              >
                {(
                  selectedWork.riskReasons ||
                  []
                ).map(
                  (
                    reason,
                    index
                  ) => (
                    <li
                      key={index}
                    >
                      {reason}
                    </li>
                  )
                )}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================================================
   STAT CARD
========================================================= */

function StatCard({
  title,
  value,
  subtitle,
  danger = false,
  onClick,
}) {
  return (
    <div
      style={{
        ...styles.statCard,
        borderTop: danger
          ? "4px solid #dc2626"
          : "4px solid #4f46e5",
        cursor: onClick
          ? "pointer"
          : "default",
      }}
      onClick={onClick}
    >
      <span
        style={
          styles.statTitle
        }
      >
        {title}
      </span>

      <strong
        style={
          styles.statValue
        }
      >
        {value}
      </strong>

      <span
        style={
          styles.statSubtitle
        }
      >
        {subtitle}
      </span>
    </div>
  );
}

/* =========================================================
   FINANCE CARD
========================================================= */

function FinanceCard({
  title,
  value,
  color,
  onClick,
}) {
  return (
    <div
      style={{
        ...styles.financeCard,
        cursor: onClick
          ? "pointer"
          : "default",
      }}
      onClick={onClick}
    >
      <span
        style={
          styles.financeTitle
        }
      >
        {title}
      </span>

      <strong
        style={{
          ...styles.financeValue,
          color:
            color || "#172033",
        }}
      >
        {value}
      </strong>
    </div>
  );
}

/* =========================================================
   LEGEND
========================================================= */

function LegendItem({
  color,
  label,
}) {
  return (
    <span
      style={
        styles.legendItem
      }
    >
      <i
        style={{
          ...styles.legendDot,
          background: color,
        }}
      />

      {label}
    </span>
  );
}

/* =========================================================
   RISK BADGE
========================================================= */

function RiskBadge({
  level,
  score,
}) {
  let background = "#e5e7eb";
  let color = "#4b5563";

  if (level === "LOW") {
    background = "#dcfce7";
    color = "#166534";
  }

  if (level === "MEDIUM") {
    background = "#fef3c7";
    color = "#92400e";
  }

  if (level === "HIGH") {
    background = "#fee2e2";
    color = "#991b1b";
  }

  if (level === "NO RISK") {
    background = "#e5e7eb";
    color = "#4b5563";
  }

  return (
    <span
      style={{
        ...styles.riskBadge,
        background,
        color,
      }}
    >
      {level || "NO RISK"}

      {score !== undefined &&
        ` · ${score}`}
    </span>
  );
}

/* =========================================================
   DETAIL
========================================================= */

function Detail({
  label,
  value,
}) {
  return (
    <div
      style={styles.detail}
    >
      <span
        style={
          styles.detailLabel
        }
      >
        {label}
      </span>

      <strong
        style={
          styles.detailValue
        }
      >
        {value || "—"}
      </strong>
    </div>
  );
}

/* =========================================================
   STYLES
========================================================= */

const styles = {
  page: {
    minHeight: "100vh",
    background: "#f5f7fb",
    color: "#172033",
    paddingBottom: "60px",
    fontFamily:
      "Inter, Arial, Helvetica, sans-serif",
  },

  /* HEADER */

  header: {
    background:
      "linear-gradient(135deg, #312e81, #4f46e5)",
    color: "white",
    padding: "36px 6%",
    display: "flex",
    justifyContent:
      "space-between",
    alignItems: "center",
    gap: "20px",
  },

  logo: {
    fontSize: "14px",
    fontWeight: "800",
    letterSpacing: "2px",
    opacity: 0.8,
  },

  title: {
    margin: "8px 0",
    fontSize: "32px",
  },

  subtitle: {
    margin: 0,
    opacity: 0.85,
    maxWidth: "650px",
    lineHeight: "1.5",
  },

  headerBadge: {
    border:
      "1px solid rgba(255,255,255,0.4)",
    borderRadius: "20px",
    padding: "8px 15px",
    fontSize: "12px",
    fontWeight: "700",
    whiteSpace: "nowrap",
  },

  /* SUMMARY */

  cards: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(210px, 1fr))",
    gap: "18px",
    padding: "30px 6% 18px",
  },

  statCard: {
    background: "white",
    borderRadius: "12px",
    padding: "20px",
    boxShadow:
      "0 3px 12px rgba(0,0,0,0.06)",
    transition:
      "transform 0.2s ease",
  },

  statTitle: {
    display: "block",
    color: "#64748b",
    fontSize: "13px",
    marginBottom: "10px",
  },

  statValue: {
    display: "block",
    fontSize: "30px",
    marginBottom: "5px",
  },

  statSubtitle: {
    color: "#94a3b8",
    fontSize: "12px",
  },

  /* FINANCIAL */

  financialCards: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "14px",
    padding: "0 6% 20px",
  },

  financeCard: {
    background: "white",
    padding: "16px",
    borderRadius: "10px",
    boxShadow:
      "0 2px 8px rgba(0,0,0,0.05)",
    transition:
      "transform 0.2s ease",
  },

  financeTitle: {
    display: "block",
    color: "#64748b",
    fontSize: "12px",
    marginBottom: "7px",
  },

  financeValue: {
    fontSize: "20px",
  },

  /* PANEL */

  panel: {
    background: "white",
    margin: "18px 6%",
    borderRadius: "14px",
    padding: "24px",
    boxShadow:
      "0 3px 15px rgba(0,0,0,0.05)",
  },

  panelHeader: {
    display: "flex",
    justifyContent:
      "space-between",
    alignItems: "center",
    marginBottom: "20px",
    gap: "15px",
  },

  panelTitle: {
    margin: 0,
    fontSize: "20px",
    color: "#000000"
  },

  panelSubtitle: {
    margin: "5px 0 0",
    color: "#64748b",
    fontSize: "13px",
    color: "#000000"
  },

  resultCount: {
    color: "#64748b",
    fontSize: "13px",
  },

  /* RISK BAR */

  riskBar: {
    height: "18px",
    borderRadius: "20px",
    overflow: "hidden",
    display: "flex",
    background: "#e2e8f0",
  },

  riskHigh: {
    background: "#dc2626",
  },

  riskMedium: {
    background: "#f59e0b",
  },

  riskLow: {
    background: "#16a34a",
  },

  /* GREY LINE / BAR FOR NO RISK */

  riskNoRisk: {
    background: "#9ca3af",
  },

  legend: {
    display: "flex",
    gap: "25px",
    marginTop: "12px",
    fontSize: "13px",
    flexWrap: "wrap",
  },

  legendItem: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
  },

  legendDot: {
    width: "10px",
    height: "10px",
    borderRadius: "50%",
    display: "inline-block",
  },

  /* FILTERS */

  filters: {
    display: "grid",
    gridTemplateColumns:
      "2fr repeat(3, 1fr)",
    gap: "12px",
  },

  search: {
    padding: "12px 14px",
    border:
      "1px solid #dbe1ea",
    borderRadius: "8px",
    outline: "none",
    fontSize: "14px",
    minWidth: 0,
  },

  select: {
    padding: "12px 14px",
    border:
      "1px solid #dbe1ea",
    borderRadius: "8px",
    background: "white",
    fontSize: "14px",
    minWidth: 0,
  },

  /* AI FILTER */

  aiFilterMessage: {
    marginTop: "15px",
    padding: "12px 15px",
    borderRadius: "8px",
    background: "#fef2f2",
    border:
      "1px solid #fecaca",
    display: "flex",
    alignItems: "center",
    gap: "12px",
    flexWrap: "wrap",
  },

  clearFilterButton: {
    marginLeft: "auto",
    border: "none",
    background: "#dc2626",
    color: "white",
    borderRadius: "6px",
    padding: "6px 10px",
    cursor: "pointer",
    fontWeight: "600",
  },

  /* TABLE */

  tableWrapper: {
    overflowX: "auto",
  },

  table: {
    width: "100%",
    borderCollapse: "collapse",
    minWidth: "1000px",
  },

  tableRow: {
    cursor: "pointer",
    borderBottom:
      "1px solid #eef1f5",
  },

  projectName: {
    fontWeight: "600",
    maxWidth: "360px",
    lineHeight: "1.4",
  },

  workId: {
    fontSize: "11px",
    color: "#94a3b8",
    marginTop: "5px",
  },

  spendingCell: {
    minWidth: "120px",
  },

  progressTrack: {
    height: "6px",
    background: "#e2e8f0",
    borderRadius: "10px",
    overflow: "hidden",
    marginBottom: "5px",
  },

  progressFill: {
    height: "100%",
    transition:
      "width 0.3s ease",
  },

  statusBadge: {
    padding: "5px 9px",
    borderRadius: "20px",
    fontSize: "11px",
    fontWeight: "600",
    whiteSpace: "nowrap",
  },

  riskBadge: {
    display: "inline-block",
    padding: "6px 10px",
    borderRadius: "20px",
    fontSize: "11px",
    fontWeight: "800",
    whiteSpace: "nowrap",
  },

  tableNote: {
    textAlign: "center",
    color: "#64748b",
    fontSize: "13px",
    marginTop: "20px",
  },

  noResults: {
    textAlign: "center",
    padding: "50px",
    color: "#64748b",
  },

  /* MODAL */

  modalOverlay: {
    position: "fixed",
    inset: 0,
    background:
      "rgba(15,23,42,0.65)",
    display: "flex",
    justifyContent:
      "center",
    alignItems: "center",
    padding: "20px",
    zIndex: 1000,
  },

  modal: {
    background: "white",
    width: "min(900px, 100%)",
    maxHeight: "90vh",
    overflowY: "auto",
    borderRadius: "16px",
    padding: "30px",
    position: "relative",
  },

  closeButton: {
    position: "absolute",
    right: "20px",
    top: "15px",
    border: "none",
    background: "#f1f5f9",
    width: "36px",
    height: "36px",
    borderRadius: "50%",
    fontSize: "25px",
    cursor: "pointer",
  },

  modalRisk: {
    marginBottom: "15px",
  },

  modalTitle: {
    margin: "0 40px 8px 0",
    fontSize: "24px",
    lineHeight: "1.3",
  },

  modalWorkId: {
    color: "#64748b",
    fontSize: "12px",
    wordBreak: "break-all",
  },

  /* DETAILS */

  detailGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "14px",
    marginTop: "25px",
  },

  detail: {
    background: "#f8fafc",
    padding: "14px",
    borderRadius: "8px",
  },

  detailLabel: {
    display: "block",
    color: "#64748b",
    fontSize: "11px",
    marginBottom: "5px",
  },

  detailValue: {
    fontSize: "14px",
    lineHeight: "1.4",
  },

  /* AI */

  aiBox: {
    marginTop: "25px",
    padding: "20px",
    background: "#f8fafc",
    borderRadius: "12px",
    border:
      "1px solid #e2e8f0",
  },

  aiTitle: {
    margin: "0 0 15px",
  },

  scoreRow: {
    display: "flex",
    justifyContent:
      "space-between",
    alignItems: "center",
    gap: "15px",
  },

  scoreLabel: {
    display: "block",
    color: "#64748b",
    fontSize: "12px",
  },

  score: {
    display: "block",
    fontSize: "30px",
    marginTop: "5px",
  },

  reasonTitle: {
    marginTop: "25px",
  },

  reasonList: {
    lineHeight: "1.8",
    color: "#334155",
  },

  /* LOADING */

  loading: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    justifyContent:
      "center",
    alignItems: "center",
    background: "#f5f7fb",
  },

  loadingSpinner: {
    width: "35px",
    height: "35px",
    border:
      "4px solid #e2e8f0",
    borderTop:
      "4px solid #4f46e5",
    borderRadius: "50%",
    marginBottom: "15px",
  },
};

export default App;