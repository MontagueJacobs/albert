#!/usr/bin/env python3
"""
Export open-ended experiment feedback into easy-to-read formats.

Input defaults to analysis_output/experiment_data_full.json.
Outputs:
  - feedback_readable.md
  - feedback_responses.csv
  - feedback_readable.txt
"""

import argparse
import csv
import json
from datetime import datetime
from pathlib import Path


def _extract_sessions(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        sessions = payload.get('sessions')
        if isinstance(sessions, list):
            return sessions
        for value in payload.values():
            if isinstance(value, list):
                return value
    return []


def _reflection_object(session):
    candidates = [
        session.get('_reflection'),
        session.get('reflection'),
        session.get('_post_questionnaire_open'),
        session.get('post_questionnaire_open'),
    ]
    for candidate in candidates:
        if isinstance(candidate, dict) and candidate:
            return candidate
    return {}


def _clean_text(value):
    if not isinstance(value, str):
        return ''
    text = value.strip()
    if not text:
        return ''
    return ' '.join(text.split())


def extract_feedback_rows(sessions):
    rows = []
    for session in sessions:
        reflection = _reflection_object(session)
        if not reflection:
            continue

        session_id = session.get('id', '')
        current_step = session.get('current_step', '')
        completed = current_step == 'complete'
        started_at = session.get('started_at', '')
        completed_at = session.get('completed_at', '')

        for question_key, raw_answer in reflection.items():
            answer = _clean_text(raw_answer)
            if not answer:
                continue
            rows.append({
                'session_id': session_id,
                'completed': completed,
                'current_step': current_step,
                'started_at': started_at,
                'completed_at': completed_at,
                'question_key': question_key,
                'answer': answer,
            })
    return rows


def write_csv(rows, output_path):
    fieldnames = [
        'session_id',
        'completed',
        'current_step',
        'started_at',
        'completed_at',
        'question_key',
        'answer',
    ]
    with output_path.open('w', newline='', encoding='utf-8') as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def write_markdown(rows, output_path):
    grouped = {}
    for row in rows:
        grouped.setdefault(row['session_id'], []).append(row)

    lines = []
    lines.append('# Experiment Feedback (Open-ended)')
    lines.append('')
    lines.append(f'Generated: {datetime.now().isoformat(timespec="seconds")}')
    lines.append(f'Total responses: {len(rows)}')
    lines.append(f'Total sessions with feedback: {len(grouped)}')
    lines.append('')

    for session_id, session_rows in grouped.items():
        first = session_rows[0]
        lines.append(f'## Session {session_id}')
        lines.append('')
        lines.append(f"- Completed: {first['completed']}")
        lines.append(f"- Current step: {first['current_step']}")
        lines.append(f"- Started at: {first['started_at']}")
        lines.append(f"- Completed at: {first['completed_at']}")
        lines.append('')
        for row in session_rows:
            lines.append(f"### {row['question_key']}")
            lines.append('')
            lines.append(row['answer'])
            lines.append('')

    output_path.write_text('\n'.join(lines), encoding='utf-8')


def write_text(rows, output_path):
    grouped = {}
    for row in rows:
        grouped.setdefault(row['session_id'], []).append(row)

    lines = []
    lines.append('EXPERIMENT FEEDBACK (OPEN-ENDED)')
    lines.append('=' * 80)
    lines.append(f'Generated: {datetime.now().isoformat(timespec="seconds")}')
    lines.append(f'Total responses: {len(rows)}')
    lines.append(f'Total sessions with feedback: {len(grouped)}')
    lines.append('')

    for session_id, session_rows in grouped.items():
        first = session_rows[0]
        lines.append('-' * 80)
        lines.append(f'Session: {session_id}')
        lines.append(f"Completed: {first['completed']} | Step: {first['current_step']}")
        lines.append(f"Started: {first['started_at']}")
        lines.append(f"Completed: {first['completed_at']}")
        lines.append('')
        for row in session_rows:
            lines.append(f"[{row['question_key']}]")
            lines.append(row['answer'])
            lines.append('')

    output_path.write_text('\n'.join(lines), encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description='Export readable open-ended feedback')
    parser.add_argument(
        '--input',
        default='./analysis_output/experiment_data_full.json',
        help='Path to experiment_data_full.json',
    )
    parser.add_argument(
        '--output-dir',
        default='./analysis_output',
        help='Directory where output files are written',
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    payload = json.loads(input_path.read_text(encoding='utf-8'))
    sessions = _extract_sessions(payload)
    rows = extract_feedback_rows(sessions)

    csv_path = output_dir / 'feedback_responses.csv'
    md_path = output_dir / 'feedback_readable.md'
    txt_path = output_dir / 'feedback_readable.txt'

    write_csv(rows, csv_path)
    write_markdown(rows, md_path)
    write_text(rows, txt_path)

    print(f'Exported {len(rows)} responses from {len(sessions)} sessions.')
    print(f'- {csv_path}')
    print(f'- {md_path}')
    print(f'- {txt_path}')


if __name__ == '__main__':
    main()
