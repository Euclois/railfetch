#!/usr/bin/env python3
import urllib.request
import csv
import json
import os

URLS = [
    # 1. David Shepherd's railway stations (check main branch)
    ("CSV", "https://raw.githubusercontent.com/davidshepherd7/railway-stations/master/stations.csv"),
    ("CSV", "https://raw.githubusercontent.com/davidshepherd7/railway-stations/main/stations.csv"),
    # 2. jbrooksuk uk-stations (check main and master)
    ("JSON", "https://raw.githubusercontent.com/jbrooksuk/uk-stations/main/stations.json"),
    ("JSON", "https://raw.githubusercontent.com/jbrooksuk/uk-stations/master/stations.json"),
    # 3. Another popular UK stations JSON source
    ("JSON", "https://raw.githubusercontent.com/pikesley/uk-stations/master/stations.json"),
    ("JSON", "https://raw.githubusercontent.com/pikesley/uk-stations/main/stations.json"),
    # 4. Huxley2 all stations list
    ("HUXLEY", "https://huxley2.azurewebsites.net/crs")
]

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public")
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "stations.json")

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    for url_type, url in URLS:
        print(f"Trying to fetch station data from ({url_type}): {url}...")
        try:
            req = urllib.request.Request(
                url, 
                headers={'User-Agent': 'Mozilla/5.0'}
            )
            with urllib.request.urlopen(req) as response:
                content = response.read()
                
            if url_type == "CSV":
                csv_content = content.decode('utf-8')
                reader = csv.reader(csv_content.splitlines())
                headers = next(reader)
                
                # Find columns
                name_idx, crs_idx = -1, -1
                for i, h in enumerate(headers):
                    h_lower = h.lower().strip()
                    if 'station_name' in h_lower or 'station name' in h_lower or h_lower == 'name':
                        name_idx = i
                    elif 'crs_code' in h_lower or 'crs code' in h_lower or h_lower == 'crs' or h_lower == 'code':
                        crs_idx = i
                
                if name_idx == -1: name_idx = 0
                if crs_idx == -1: crs_idx = 1
                
                stations = {}
                for row in reader:
                    if len(row) > max(name_idx, crs_idx):
                        name = row[name_idx].strip()
                        crs = row[crs_idx].strip().upper()
                        if crs and len(crs) == 3 and name:
                            stations[crs] = {"name": name, "crs": crs}
                
                station_list = sorted(list(stations.values()), key=lambda x: x["name"])
                if station_list:
                    write_json(station_list)
                    return
                    
            elif url_type == "JSON":
                data = json.loads(content.decode('utf-8'))
                station_list = []
                
                # Format can be list of dicts, or dict of crs:name
                if isinstance(data, list):
                    for st in data:
                        name = st.get('name') or st.get('station_name') or st.get('stationName')
                        crs = st.get('code') or st.get('crs') or st.get('crs_code') or st.get('crsCode')
                        if name and crs:
                            station_list.append({"name": name.strip(), "crs": crs.strip().upper()})
                elif isinstance(data, dict):
                    for crs, name in data.items():
                        if len(crs) == 3 and isinstance(name, str):
                            station_list.append({"name": name.strip(), "crs": crs.strip().upper()})
                
                station_list = sorted(station_list, key=lambda x: x["name"])
                if station_list:
                    write_json(station_list)
                    return
                    
            elif url_type == "HUXLEY":
                # Huxley 2 /crs endpoint returns a list of stations
                # Format is usually [{"stationName": "...", "crsCode": "..."}, ...]
                data = json.loads(content.decode('utf-8'))
                station_list = []
                for st in data:
                    name = st.get('stationName') or st.get('name')
                    crs = st.get('crsCode') or st.get('crs')
                    if name and crs:
                        station_list.append({"name": name.strip(), "crs": crs.strip().upper()})
                        
                station_list = sorted(station_list, key=lambda x: x["name"])
                if station_list:
                    write_json(station_list)
                    return
                    
        except Exception as e:
            print(f"Failed to fetch or parse: {e}")
            continue
            
    print("All URLs failed. We will generate a solid baseline station list containing Manchester Piccadilly (MAN), Salford Crescent (SLD), Manchester Victoria (MCV), and other major UK stations as a fallback.")
    fallback_stations = [
        {"name": "Manchester Piccadilly", "crs": "MAN"},
        {"name": "Salford Crescent", "crs": "SLD"},
        {"name": "Manchester Victoria", "crs": "MCV"},
        {"name": "London Euston", "crs": "EUS"},
        {"name": "London St Pancras International", "crs": "STP"},
        {"name": "London Kings Cross", "crs": "KGX"},
        {"name": "London Paddington", "crs": "PAD"},
        {"name": "Birmingham New Street", "crs": "BHM"},
        {"name": "Leeds", "crs": "LDS"},
        {"name": "Liverpool Lime Street", "crs": "LIV"},
        {"name": "Glasgow Central", "crs": "GLC"},
        {"name": "Edinburgh", "crs": "EDB"},
        {"name": "Newcastle", "crs": "NCL"},
        {"name": "Bristol Temple Meads", "crs": "BRI"},
        {"name": "Cardiff Central", "crs": "CDF"},
        {"name": "Sheffield", "crs": "SHF"},
        {"name": "York", "crs": "YRK"},
    ]
    write_json(fallback_stations)

def write_json(station_list):
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(station_list, f, indent=2, ensure_ascii=False)
    print(f"Successfully generated {OUTPUT_FILE} with {len(station_list)} records!")

if __name__ == "__main__":
    main()
