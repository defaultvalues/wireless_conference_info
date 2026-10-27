#!/usr/bin/env python3
"""Run once on GitHub Actions, preserving the last successful per-source data."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from collector import ConferenceStore

def atomic_json(path,payload):
    path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_suffix('.tmp')
    temporary.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    temporary.replace(path)

def update(seed_path, output, fetch=None):
    seed=json.loads(seed_path.read_text(encoding='utf-8'))
    # The tracked output is the durable previous snapshot, including on new runners.
    store=ConferenceStore(seed,output)
    payload=store.refresh() if fetch is None else store.refresh(fetch)
    payload.update(schemaVersion=1,mode='github-actions',generatedAt=datetime.now(timezone.utc).isoformat(),scheduleHours=1)
    atomic_json(output,payload)
    return payload

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--seed',type=Path,default=ROOT/'dist/conferences.json')
    parser.add_argument('--output',type=Path,default=ROOT/'data/latest.json')
    args=parser.parse_args()
    payload=update(args.seed,args.output)
    summary=f"Official sources checked: {payload['freshCount']}/{payload['totalCount']}; status: {payload['status']}"
    print(summary)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'],'a',encoding='utf-8') as stream:
            stream.write('## Conference data update\n\n'+summary+'\n\n')
            for c in payload['conferences']:
                stream.write(f"- {c['name']}: {c['syncStatus']}; last successful check: {c.get('lastChecked','initial snapshot')}\n")
    if payload['status']=='offline':
        print('::warning::All official source checks failed; publishing the previous dates with a visible stale-data notice.')

if __name__=='__main__':main()
