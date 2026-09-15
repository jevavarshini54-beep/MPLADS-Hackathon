import pandas as pd
import numpy as np
import re
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import IsolationForest


# =========================================================
# FILE PATHS
# =========================================================

SANCTIONED_FILE = "Lok-Sabha-Data/Works Sanctioned_Lok.xlsx"

EXPENDITURE_FILE = (
    "Lok-Sabha-Data/"
    "Expenditure on Completed and On-going Works as on Date_Lok.xlsx"
)

COMPLETED_FILE = "Lok-Sabha-Data/Works Completed_Lok.xlsx"

OUTPUT_FILE = "risk_results.csv"


# =========================================================
# HELPERS
# =========================================================

def clean_work_id(value):
    """
    Extract the main Work ID.

    Example:
    WS/MP18076/2024-2025/145678
    """

    if pd.isna(value):
        return ""

    value = str(value).strip()

    # Remove extra spaces
    value = re.sub(r"\s+", " ", value)

    # Main MPLADS work ID
    match = re.search(
        r"(WS/MP\d+/\d{4}-\d{4}/\d+)",
        value,
        re.IGNORECASE
    )

    if match:
        return match.group(1).upper()

    return value


def to_number(value):
    """
    Convert money/string values into numbers.
    """

    if pd.isna(value):
        return 0.0

    if isinstance(value, (int, float, np.number)):
        return float(value)

    value = str(value)

    value = (
        value
        .replace("₹", "")
        .replace(",", "")
        .replace("%", "")
        .strip()
    )

    try:
        return float(value)
    except:
        return 0.0


def parse_date(value):
    """
    Safely convert value to pandas datetime.
    """

    if pd.isna(value):
        return pd.NaT

    return pd.to_datetime(
        value,
        errors="coerce",
        dayfirst=True
    )


# =========================================================
# LOAD DATA
# =========================================================

print("Loading datasets...")

sanctioned = pd.read_excel(SANCTIONED_FILE)

expenditure = pd.read_excel(EXPENDITURE_FILE)

completed = pd.read_excel(COMPLETED_FILE)

print("Sanctioned:", len(sanctioned))
print("Expenditure:", len(expenditure))
print("Completed:", len(completed))


# =========================================================
# NORMALIZE COLUMN NAMES
# =========================================================

sanctioned.columns = sanctioned.columns.astype(str).str.strip()

expenditure.columns = expenditure.columns.astype(str).str.strip()

completed.columns = completed.columns.astype(str).str.strip()


# =========================================================
# CREATE WORK ID
# =========================================================

sanctioned["work_id"] = sanctioned["Work ID"].apply(
    clean_work_id
)

expenditure["work_id"] = expenditure["Work ID"].apply(
    clean_work_id
)

completed["work_id"] = completed["Work"].apply(
    clean_work_id
)


# =========================================================
# SANCTIONED DATA
# =========================================================

sanctioned["sanction_amount"] = sanctioned[
    "Sanction Amount ( ₹ )"
].apply(to_number)

sanctioned["sanction_date"] = sanctioned[
    "Sanction Date"
].apply(parse_date)


# =========================================================
# EXTRACT YEAR FROM WORK ID
# =========================================================

def extract_year(work_id):

    if not work_id:
        return np.nan

    match = re.search(
        r"/(\d{4})-\d{4}/",
        str(work_id)
    )

    if match:
        return int(match.group(1))

    return np.nan


sanctioned["sanction_year"] = sanctioned[
    "work_id"
].apply(extract_year)


# =========================================================
# EXPENDITURE MAP
# =========================================================

print("Building expenditure map...")

expenditure["disbursed_amount"] = expenditure[
    "Fund Disbursed Amount ( ₹ )"
].apply(to_number)


expenditure_map = (
    expenditure
    .groupby("work_id")
    .agg(
        total_disbursed=(
            "disbursed_amount",
            "sum"
        ),

        expenditure_records=(
            "work_id",
            "count"
        )
    )
    .reset_index()
)


# =========================================================
# VENDOR COUNT
# =========================================================

if "Vendor Name" in expenditure.columns:

    vendor_count = (
        expenditure
        .dropna(subset=["Vendor Name"])
        .assign(
            vendor_clean=lambda x:
            x["Vendor Name"]
            .astype(str)
            .str.strip()
        )
        .groupby("work_id")["vendor_clean"]
        .nunique()
        .reset_index(name="vendor_count")
    )

else:

    vendor_count = pd.DataFrame(
        columns=[
            "work_id",
            "vendor_count"
        ]
    )


# =========================================================
# MERGE EXPENDITURE
# =========================================================

df = sanctioned.merge(
    expenditure_map,
    on="work_id",
    how="left"
)

df = df.merge(
    vendor_count,
    on="work_id",
    how="left"
)


df["total_disbursed"] = (
    df["total_disbursed"]
    .fillna(0)
)

df["expenditure_records"] = (
    df["expenditure_records"]
    .fillna(0)
)

df["vendor_count"] = (
    df["vendor_count"]
    .fillna(0)
)


# =========================================================
# COMPLETION DATA
# =========================================================

print("Processing completion data...")


completed["completion_date"] = completed[
    "Completion Date"
].apply(parse_date)


# Keep one completion record per work
completion_lookup = (
    completed[
        [
            "work_id",
            "completion_date"
        ]
    ]
    .dropna(subset=["work_id"])
    .drop_duplicates(
        subset=["work_id"],
        keep="first"
    )
)


# =========================================================
# MERGE COMPLETION
# =========================================================

df = df.merge(
    completion_lookup,
    on="work_id",
    how="left"
)


# =========================================================
# COMPLETION STATUS
# =========================================================

df["completed"] = (
    df["completion_date"]
    .notna()
)


# =========================================================
# COMPLETION TIME
# =========================================================

df["completion_days"] = np.nan

mask = (
    df["completed"]
    & df["sanction_date"].notna()
    & df["completion_date"].notna()
)

df.loc[mask, "completion_days"] = (
    df.loc[mask, "completion_date"]
    - df.loc[mask, "sanction_date"]
).dt.days


# =========================================================
# EXPECTED COMPLETION TIME
# =========================================================

"""
We estimate expected completion time from historical
completed MPLADS works.

This is NOT a government-prescribed deadline.

It is a data-driven benchmark.
"""


completed_history = df[
    df["completion_days"].notna()
    & (df["completion_days"] > 0)
].copy()


if len(completed_history) >= 10:

    expected_completion_days = (
        completed_history[
            "completion_days"
        ].median()
    )

else:

    # Fallback benchmark
    expected_completion_days = 365


df["expected_completion_days"] = (
    expected_completion_days
)


# =========================================================
# DELAY
# =========================================================

df["delay_days"] = 0.0

completed_mask = (
    df["completion_days"].notna()
)

df.loc[completed_mask, "delay_days"] = (
    df.loc[completed_mask, "completion_days"]
    - expected_completion_days
)


# For ongoing projects calculate elapsed time
ongoing_mask = (
    ~df["completed"]
    & df["sanction_date"].notna()
)

today = pd.Timestamp.today()

df.loc[ongoing_mask, "elapsed_days"] = (
    today
    - df.loc[ongoing_mask, "sanction_date"]
).dt.days


df["elapsed_days"] = (
    df["elapsed_days"]
    .fillna(0)
)


# =========================================================
# SPENDING %
# =========================================================

df["spending_percentage"] = np.where(
    df["sanction_amount"] > 0,

    (
        df["total_disbursed"]
        /
        df["sanction_amount"]
    ) * 100,

    0
)


# =========================================================
# SPENDING VS COMPLETION
# =========================================================

"""
If a project is completed, we DO NOT assume that
spending percentage must be 100%.

The system only flags extreme financial anomalies.
"""


# =========================================================
# ML FEATURES
# =========================================================

features = pd.DataFrame({

    "sanction_amount":
        df["sanction_amount"],

    "total_disbursed":
        df["total_disbursed"],

    "spending_percentage":
        df["spending_percentage"],

    "vendor_count":
        df["vendor_count"],

    "expenditure_records":
        df["expenditure_records"],

    "completion_days":
        df["completion_days"].fillna(
            expected_completion_days
        ),

    "elapsed_days":
        df["elapsed_days"],

})


# =========================================================
# CLEAN ML DATA
# =========================================================

features = features.replace(
    [np.inf, -np.inf],
    np.nan
)

features = features.fillna(0)


# =========================================================
# STANDARD SCALER
# =========================================================

scaler = StandardScaler()

X_scaled = scaler.fit_transform(
    features
)


# =========================================================
# ISOLATION FOREST
# =========================================================

print("Running ML anomaly detection...")


model = IsolationForest(
    n_estimators=200,
    contamination=0.05,
    random_state=42
)


model.fit(X_scaled)


df["ml_prediction"] = model.predict(
    X_scaled
)


df["ml_anomaly_score"] = (
    -model.decision_function(X_scaled)
)


# =========================================================
# NORMALIZE ML SCORE
# =========================================================

minimum = df[
    "ml_anomaly_score"
].min()

maximum = df[
    "ml_anomaly_score"
].max()


if maximum > minimum:

    df["ml_score"] = (
        (
            df["ml_anomaly_score"]
            - minimum
        )
        /
        (
            maximum
            - minimum
        )
    ) * 100

else:

    df["ml_score"] = 0


# =========================================================
# RULE-BASED RISK
# =========================================================

def calculate_rule_risk(row):

    score = 0

    reasons = []


    # -----------------------------------------------------
    # 1. Overspending
    # -----------------------------------------------------

    if row["spending_percentage"] > 100:

        score += 40

        reasons.append(
            "Disbursed amount exceeds sanctioned amount"
        )


    # -----------------------------------------------------
    # 2. Very high spending on incomplete work
    # -----------------------------------------------------

    if (
        row["spending_percentage"] > 80
        and not row["completed"]
    ):

        score += 25

        reasons.append(
            "High spending but project is not completed"
        )


    # -----------------------------------------------------
    # 3. Completion delay
    # -----------------------------------------------------

    if (
        row["completed"]
        and row["completion_days"] >
        expected_completion_days * 1.5
    ):

        score += 20

        reasons.append(
            "Completion time is significantly above "
            "the historical benchmark"
        )


    # -----------------------------------------------------
    # 4. Ongoing project with long elapsed time
    # -----------------------------------------------------

    if (
        not row["completed"]
        and row["elapsed_days"] >
        expected_completion_days * 1.5
    ):

        score += 20

        reasons.append(
            "Project has remained ongoing significantly "
            "longer than the historical benchmark"
        )


    # -----------------------------------------------------
    # 5. Multiple vendors
    # -----------------------------------------------------

    if row["vendor_count"] >= 5:

        score += 10

        reasons.append(
            "Multiple vendors involved"
        )


    # -----------------------------------------------------
    # 6. Very large project
    # -----------------------------------------------------

    if row["sanction_amount"] >= 10000000:

        score += 15

        reasons.append(
            "Very high sanctioned amount"
        )


    # -----------------------------------------------------
    # 7. Completed but no expenditure
    # -----------------------------------------------------

    if (
        row["completed"]
        and row["total_disbursed"] == 0
    ):

        score += 15

        reasons.append(
            "Completed work has no matched expenditure"
        )


    # -----------------------------------------------------
    # 8. High spending relative to completion
    # -----------------------------------------------------

    if (
        not row["completed"]
        and row["spending_percentage"] > 60
    ):

        score += 15

        reasons.append(
            "Large proportion of funds disbursed "
            "while work remains incomplete"
        )


    # -----------------------------------------------------
    # NO RULE-BASED ANOMALY
    # -----------------------------------------------------

    if len(reasons) == 0:

        reasons.append(
            "No major anomaly detected by current rules"
        )


    return min(score, 100), reasons


# =========================================================
# APPLY RULE RISK
# =========================================================

rule_results = df.apply(
    calculate_rule_risk,
    axis=1
)


df["rule_score"] = rule_results.apply(
    lambda x: x[0]
)

df["risk_reasons"] = rule_results.apply(
    lambda x: " | ".join(x[1])
)


# =========================================================
# FINAL RISK SCORE
# =========================================================

"""
Combine:

60% rule-based risk
40% ML anomaly score
"""

df["risk_score"] = (
    0.60 * df["rule_score"]
    +
    0.40 * df["ml_score"]
)


df["risk_score"] = (
    df["risk_score"]
    .clip(0, 100)
    .round(1)
)


# =========================================================
# RISK LEVEL
# =========================================================

def get_risk_level(row):

    # No rule-based anomaly = No Risk
    if row["rule_score"] == 0:
        return "NO RISK"

    score = row["risk_score"]

    if score >= 50:
        return "HIGH"

    elif score >= 20:
        return "MEDIUM"

    else:
        return "LOW"

df["risk_level"] = df.apply(
    get_risk_level,
    axis=1
)

# =========================================================
# RISK INTERVAL OF 10
# =========================================================

def get_risk_interval(score):

    if score <= 0:
        return "0"

    lower = int(score // 10) * 10
    upper = lower + 10

    if upper > 100:
        upper = 100

    return f"{lower}-{upper}"


df["risk_interval"] = (
    df["risk_score"]
    .apply(get_risk_interval)
)


# =========================================================
# ML FLAG
# =========================================================

df["ml_flag"] = np.where(
    df["ml_prediction"] == -1,
    "ANOMALY",
    "NORMAL"
)


# =========================================================
# EXPECTED COMPLETION STATUS
# =========================================================

def completion_status(row):

    if row["completed"]:

        if (
            row["completion_days"]
            <= expected_completion_days
        ):
            return "Completed within benchmark"

        else:
            return "Completed slower than benchmark"


    if (
        row["elapsed_days"]
        > expected_completion_days
    ):

        return "Ongoing beyond benchmark"

    return "Ongoing"


df["completion_status"] = df.apply(
    completion_status,
    axis=1
)


# =========================================================
# OUTPUT COLUMNS
# =========================================================

output_columns = [

    "work_id",

    "Work category",

    "State",

    "Hon'ble Members of Parliament",

    "Constituency",

    "Work description",

    "Recommended date",

    "Sanction Date",

    "sanction_amount",

    "Work Status",

    "total_disbursed",

    "spending_percentage",

    "vendor_count",

    "expenditure_records",

    "completion_date",

    "completed",

    "completion_days",

    "expected_completion_days",

    "elapsed_days",

    "delay_days",

    "completion_status",

    "rule_score",

    "ml_score",

    "ml_flag",

    "risk_score",

    "risk_interval",

    "risk_level",

    "risk_reasons",

]


# Only include columns that actually exist
output_columns = [
    col for col in output_columns
    if col in df.columns
]


result = df[output_columns].copy()


# =========================================================
# SORT BY RISK
# =========================================================

result = result.sort_values(
    "risk_score",
    ascending=False
)


# =========================================================
# SAVE
# =========================================================

result.to_csv(
    OUTPUT_FILE,
    index=False
)


# =========================================================
# SUMMARY
# =========================================================

print()
print("=" * 60)
print("ML TRAINING COMPLETE")
print("=" * 60)

print(
    "Expected completion benchmark:",
    round(expected_completion_days, 1),
    "days"
)

print(
    "Total projects:",
    len(result)
)

print(
    "High risk:",
    len(
        result[
            result["risk_level"] == "HIGH"
        ]
    )
)

print(
    "Medium risk:",
    len(
        result[
            result["risk_level"] == "MEDIUM"
        ]
    )
)

print(
    "Low risk:",
    len(
        result[
            result["risk_level"] == "LOW"
        ]
    )
)

print(
    "No risk:",
    len(
        result[
            result["risk_level"] == "NO RISK"
        ]
    )
)

print()
print(
    "Output:",
    OUTPUT_FILE
)

print("=" * 60)