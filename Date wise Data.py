import requests
import pandas as pd
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
import urllib3
import time

# Disable SSL warnings
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

API_1 = "https://app2app.io/vptapi/Api/Report/DashboardDetailReport"
API_2 = "https://app2app.io/vptapi/Api/Report/DashboardDetail2Report?ExtensionId={}"

MAX_WORKERS = 4          # 🔥 reduced (stable)
MAX_RETRIES = 2          # retry count

def get_all_extensions():
    r = requests.get(API_1, timeout=20, verify=False)
    r.raise_for_status()
    return r.json().get("data", {}).get("detail", [])

def fetch_extension_data(ext):
    ext_id = ext.get("extensionId")
    ext_name = ext.get("extensionName")

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = requests.get(
                API_2.format(ext_id),
                timeout=(10, 30),   # connect, read
                verify=False
            )
            r.raise_for_status()
            records = r.json().get("data", {}).get("detail2", [])
            return ext_id, ext_name, records

        except Exception as e:
            print(f"⚠️ Retry {attempt}/{MAX_RETRIES} → {ext_name}")
            time.sleep(2)

    print(f"❌ Skipped after retries → {ext_name}")
    return ext_id, ext_name, None

def main():
    extensions = get_all_extensions()

    date_count = defaultdict(lambda: defaultdict(int))
    detailed_rows = []
    failed_extensions = []

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = [executor.submit(fetch_extension_data, ext) for ext in extensions]

        for future in as_completed(futures):
            ext_id, ext_name, records = future.result()

            if records is None:
                failed_extensions.append(ext_name)
                continue

            for r in records:
                automation_start = r.get("automationStart")
                if automation_start:
                    date_only = automation_start.split("T")[0]
                else:
                    date_only = "Unknown"

                date_count[(ext_id, ext_name)][date_only] += 1

                detailed_rows.append({
                    "incidenceId": r.get("incidenceId"),
                    "extensionId": r.get("extensionId"),
                    "extensionName": r.get("extensionName"),
                    "keyword": r.get("keyword"),
                    "automationStart": automation_start,
                    "videoFilePath": r.get("videoFilePath"),
                    "screenShotPath": r.get("screenShotPath"),
                    "networkLogFilePath": r.get("networkLogFilePath"),
                    "landingUrl": r.get("landingUrl"),
                    "voilationTypeFLP": r.get("voilationTypeFLP"),
                    "type": r.get("type"),
                    "landingScreenshot": r.get("landingScreenshot"),
                    "brandUrl": r.get("brandUrl"),
                    "finalLandingUrl": r.get("finalLandingUrl"),
                    "redirectionURL": r.get("redirectionURL"),
                    "redirectionURLFLP": r.get("redirectionURLFLP"),
                    "networks": r.get("networks"),
                    "automationEnd": r.get("automationEnd"),
                    "couponSite": r.get("couponSite"),
                    "redirectionURL2": r.get("redirectionURL2"),
                    "redirectionURL2FLP": r.get("redirectionURL2FLP"),
                    "pubName": r.get("pubName"),
                    "pubValue": r.get("pubValue"),
                    "advName": r.get("advName"),
                    "advValue": r.get("advValue"),
                    "vm": r.get("vm")
                })

    # ---------- Sheet 1 ----------
    count_rows = []
    for (eid, name), dates in date_count.items():
        for d, c in dates.items():
            count_rows.append({
                "Extension ID": eid,
                "Extension Name": name,
                "Date": d,
                "Total Records": c
            })

    df_count = pd.DataFrame(count_rows)
    df_count.sort_values(["Extension Name", "Date"], inplace=True)

    # ---------- Sheet 2 ----------
    df_detail = pd.DataFrame(detailed_rows)
    df_detail["automationStart"] = pd.to_datetime(df_detail["automationStart"], errors='coerce')
    df_detail.sort_values("automationStart", ascending=False, inplace=True)

    # ---------- Save Excel ----------
    with pd.ExcelWriter("Extension_Report.xlsx", engine="openpyxl") as writer:
        df_count.to_excel(writer, sheet_name="Date_Wise_Count", index=False)
        df_detail.to_excel(writer, sheet_name="Detailed_Data", index=False)

    # ---------- Save JSON ----------
    df_detail.to_json(
        "data.json",
        orient="records",
        date_format="iso",
        indent=2
    )

    # ---------- Failed log ----------
    if failed_extensions:
        with open("failed_extensions.txt", "w", encoding="utf-8") as f:
            for name in failed_extensions:
                f.write(name + "\n")

    print("\n✅ Script completed safely")
    print("✅ Excel + JSON generated")
    print(f"⚠️ Failed extensions: {len(failed_extensions)}")

if __name__ == "__main__":
    main()
