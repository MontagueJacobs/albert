#!/usr/bin/env python3
"""
Experiment Data Analysis Script

Analyzes data from the CO2 awareness experiment.
Connects to the local server's export API to fetch data.

Usage:
    python analyze_experiment.py [--server URL] [--completed-only] [--output DIR]
    
Example:
    python analyze_experiment.py --server http://localhost:3001 --completed-only
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

import requests
import pandas as pd
import numpy as np
from scipy import stats

# Optional: matplotlib for visualizations
try:
    import matplotlib.pyplot as plt
    import matplotlib
    matplotlib.use('Agg')  # Non-interactive backend
    HAS_MATPLOTLIB = True
except ImportError:
    HAS_MATPLOTLIB = False
    print("Note: matplotlib not installed. Charts will be skipped.")


def fetch_experiment_data(server_url: str, completed_only: bool = False) -> dict:
    """Fetch experiment data from the server API."""
    url = f"{server_url}/api/admin/experiment/export"
    params = {}
    if completed_only:
        params['completedOnly'] = 'true'
    
    print(f"📡 Fetching data from {url}...")
    response = requests.get(url, params=params, timeout=30)
    response.raise_for_status()
    return response.json()


def fetch_summary(server_url: str) -> dict:
    """Fetch summary statistics from the server."""
    url = f"{server_url}/api/admin/experiment/summary"
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    return response.json()


def create_dataframe(data: dict) -> pd.DataFrame:
    """Convert API response to pandas DataFrame."""
    sessions = data.get('sessions', [])
    if not sessions:
        return pd.DataFrame()
    
    # Extract flat fields (exclude raw JSONB columns starting with _)
    flat_data = []
    for s in sessions:
        row = {k: v for k, v in s.items() if not k.startswith('_')}
        flat_data.append(row)
    
    df = pd.DataFrame(flat_data)
    
    # Convert timestamps
    for col in ['started_at', 'completed_at', 'updated_at']:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors='coerce')
    
    return df


def analyze_learning_effect(df: pd.DataFrame) -> dict:
    """
    Analyze pre-post quiz score changes using paired t-tests.
    Returns statistical results for each quiz pair.
    """
    results = {}
    
    quiz_pairs = [
        ('quiz1_score', 'quiz3_score', 'Generic products'),
        ('quiz5_score', 'quiz6_score', 'AH-specific products'),
        ('quiz2_score', 'quiz4_score', 'Personal products'),
    ]
    
    for pre_col, post_col, label in quiz_pairs:
        if pre_col not in df.columns or post_col not in df.columns:
            continue
        
        # Get paired data (both pre and post available)
        paired = df[[pre_col, post_col]].dropna()
        
        if len(paired) < 3:
            results[label] = {'error': f'Insufficient data (n={len(paired)})'}
            continue
        
        pre_scores = paired[pre_col]
        post_scores = paired[post_col]
        
        # Descriptive statistics
        pre_mean = pre_scores.mean()
        post_mean = post_scores.mean()
        improvement = post_mean - pre_mean
        
        # Paired t-test
        t_stat, p_value = stats.ttest_rel(post_scores, pre_scores)
        
        # Wilcoxon signed-rank test (non-parametric alternative)
        try:
            w_stat, w_pvalue = stats.wilcoxon(post_scores - pre_scores)
        except ValueError:
            w_stat, w_pvalue = None, None
        
        # Effect size (Cohen's d for paired samples)
        diff = post_scores - pre_scores
        cohens_d = diff.mean() / diff.std() if diff.std() > 0 else 0
        
        results[label] = {
            'n': len(paired),
            'pre_mean': round(pre_mean, 2),
            'post_mean': round(post_mean, 2),
            'improvement': round(improvement, 2),
            'pre_std': round(pre_scores.std(), 2),
            'post_std': round(post_scores.std(), 2),
            't_statistic': round(t_stat, 3),
            'p_value': round(p_value, 4),
            'wilcoxon_stat': round(w_stat, 3) if w_stat else None,
            'wilcoxon_p': round(w_pvalue, 4) if w_pvalue else None,
            'cohens_d': round(cohens_d, 3),
            'significant_005': p_value < 0.05,
            'significant_001': p_value < 0.01,
        }
    
    return results


def analyze_demographics(df: pd.DataFrame) -> dict:
    """Analyze quiz performance broken down by demographics."""
    results = {}
    
    # Improvement columns
    improvement_cols = ['generic_improvement', 'ah_improvement', 'personal_improvement']
    
    demo_cols = {
        'demo_gender': 'Gender',
        'demo_education': 'Education', 
        'demo_diet': 'Diet',
        'demo_shopping_frequency': 'Shopping Frequency'
    }
    
    for demo_col, demo_label in demo_cols.items():
        if demo_col not in df.columns:
            continue
        
        breakdown = {}
        for group in df[demo_col].dropna().unique():
            group_df = df[df[demo_col] == group]
            group_stats = {'n': len(group_df)}
            
            for imp_col in improvement_cols:
                if imp_col in df.columns:
                    values = group_df[imp_col].dropna()
                    if len(values) > 0:
                        group_stats[imp_col] = {
                            'mean': round(values.mean(), 2),
                            'std': round(values.std(), 2),
                            'n': len(values)
                        }
            
            breakdown[group] = group_stats
        
        results[demo_label] = breakdown
    
    return results


def analyze_questionnaires(df: pd.DataFrame) -> dict:
    """Analyze pre and post questionnaire responses."""
    results = {}
    
    # Pre-questionnaire columns
    pre_cols = [c for c in df.columns if c.startswith('pre_q')]
    post_cols = [c for c in df.columns if c.startswith('post_q')]
    
    if pre_cols:
        pre_stats = {}
        for col in pre_cols:
            values = df[col].dropna()
            if len(values) > 0:
                pre_stats[col] = {
                    'mean': round(values.mean(), 2),
                    'std': round(values.std(), 2),
                    'median': values.median(),
                    'n': len(values)
                }
        results['pre_questionnaire'] = pre_stats
    
    if post_cols:
        post_stats = {}
        for col in post_cols:
            values = df[col].dropna()
            if len(values) > 0:
                post_stats[col] = {
                    'mean': round(values.mean(), 2),
                    'std': round(values.std(), 2),
                    'median': values.median(),
                    'n': len(values)
                }
        results['post_questionnaire'] = post_stats
    
    return results


def extract_qualitative_responses(data: dict) -> list:
    """Extract open-ended reflection responses for qualitative analysis."""
    responses = []
    
    for session in data.get('sessions', []):
        reflection = session.get('_post_questionnaire_open') or session.get('_reflection') or {}
        if reflection:
            entry = {
                'session_id': session.get('id'),
                'completed': session.get('current_step') == 'complete'
            }
            # Extract text responses
            for key, value in reflection.items():
                if isinstance(value, str) and value.strip():
                    entry[key] = value.strip()
            
            if len(entry) > 2:  # Has actual responses beyond id and completed
                responses.append(entry)
    
    return responses


def generate_charts(df: pd.DataFrame, output_dir: Path):
    """Generate visualization charts."""
    if not HAS_MATPLOTLIB:
        return
    
    # 1. Pre vs Post Quiz Scores
    fig, axes = plt.subplots(1, 3, figsize=(14, 5))
    
    quiz_pairs = [
        ('quiz1_score', 'quiz3_score', 'Generic Products'),
        ('quiz5_score', 'quiz6_score', 'AH Products'),
        ('quiz2_score', 'quiz4_score', 'Personal Products'),
    ]
    
    for ax, (pre, post, title) in zip(axes, quiz_pairs):
        if pre in df.columns and post in df.columns:
            data_pre = df[pre].dropna()
            data_post = df[post].dropna()
            
            ax.boxplot([data_pre, data_post], labels=['Pre', 'Post'])
            ax.set_title(title)
            ax.set_ylabel('Score (0-100)')
            ax.set_ylim(0, 105)
    
    plt.suptitle('Pre vs Post Intervention Quiz Scores', fontsize=14)
    plt.tight_layout()
    plt.savefig(output_dir / 'quiz_scores_comparison.png', dpi=150)
    plt.close()
    
    # 2. Learning Effect Distribution
    fig, ax = plt.subplots(figsize=(10, 6))
    
    improvements = []
    labels = []
    for col, label in [
        ('generic_improvement', 'Generic'),
        ('ah_improvement', 'AH-specific'),
        ('personal_improvement', 'Personal')
    ]:
        if col in df.columns:
            data = df[col].dropna()
            if len(data) > 0:
                improvements.append(data)
                labels.append(f'{label}\n(n={len(data)})')
    
    if improvements:
        ax.boxplot(improvements, labels=labels)
        ax.axhline(y=0, color='r', linestyle='--', alpha=0.5)
        ax.set_ylabel('Score Improvement (Post - Pre)')
        ax.set_title('Learning Effect by Quiz Type')
        plt.tight_layout()
        plt.savefig(output_dir / 'learning_effect.png', dpi=150)
    plt.close()
    
    # 3. Demographics breakdown
    if 'demo_diet' in df.columns and 'generic_improvement' in df.columns:
        fig, ax = plt.subplots(figsize=(10, 6))
        
        diet_groups = df.groupby('demo_diet')['generic_improvement'].agg(['mean', 'std', 'count'])
        diet_groups = diet_groups[diet_groups['count'] >= 2]  # At least 2 participants
        
        if len(diet_groups) > 0:
            ax.bar(diet_groups.index, diet_groups['mean'], yerr=diet_groups['std'], capsize=5)
            ax.axhline(y=0, color='r', linestyle='--', alpha=0.5)
            ax.set_ylabel('Mean Improvement')
            ax.set_title('Learning Effect by Diet Type')
            ax.set_xlabel('Diet')
            plt.xticks(rotation=45, ha='right')
            plt.tight_layout()
            plt.savefig(output_dir / 'improvement_by_diet.png', dpi=150)
        plt.close()
    
    print(f"📊 Charts saved to {output_dir}")


def generate_report(df: pd.DataFrame, data: dict, summary: dict, output_dir: Path) -> str:
    """Generate a text report with all analysis results."""
    lines = []
    lines.append("=" * 70)
    lines.append("CO2 AWARENESS EXPERIMENT - DATA ANALYSIS REPORT")
    lines.append(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    lines.append("=" * 70)
    lines.append("")
    
    # Overview
    lines.append("## OVERVIEW")
    lines.append("-" * 40)
    s = summary.get('summary', {})
    lines.append(f"Total sessions:     {s.get('total', 0)}")
    lines.append(f"Completed:          {s.get('completed', 0)} ({s.get('completionRate', '0%')})")
    lines.append(f"With consent:       {s.get('withConsent', 0)}")
    lines.append("")
    
    # Average Scores
    lines.append("## AVERAGE QUIZ SCORES (Completed Sessions)")
    lines.append("-" * 40)
    avg = summary.get('averageScores', {})
    lines.append(f"Quiz 1 (Pre-Generic):    {avg.get('quiz1_pre_generic', 'N/A')}")
    lines.append(f"Quiz 3 (Post-Generic):   {avg.get('quiz3_post_generic', 'N/A')}")
    lines.append(f"Quiz 5 (Pre-AH):         {avg.get('quiz5_pre_ah', 'N/A')}")
    lines.append(f"Quiz 6 (Post-AH):        {avg.get('quiz6_post_ah', 'N/A')}")
    lines.append(f"Quiz 2 (Pre-Personal):   {avg.get('quiz2_pre_personal', 'N/A')}")
    lines.append(f"Quiz 4 (Post-Personal):  {avg.get('quiz4_post_personal', 'N/A')}")
    lines.append("")
    
    # Learning Effect Analysis
    lines.append("## LEARNING EFFECT ANALYSIS")
    lines.append("-" * 40)
    learning = analyze_learning_effect(df)
    
    for label, result in learning.items():
        lines.append(f"\n### {label}")
        if 'error' in result:
            lines.append(f"  {result['error']}")
            continue
        
        lines.append(f"  Sample size (n):       {result['n']}")
        lines.append(f"  Pre-test mean (SD):    {result['pre_mean']} ({result['pre_std']})")
        lines.append(f"  Post-test mean (SD):   {result['post_mean']} ({result['post_std']})")
        lines.append(f"  Mean improvement:      {result['improvement']}")
        lines.append(f"  ")
        lines.append(f"  Paired t-test:")
        lines.append(f"    t-statistic:         {result['t_statistic']}")
        lines.append(f"    p-value:             {result['p_value']}")
        sig = "***" if result['significant_001'] else ("**" if result['significant_005'] else "ns")
        lines.append(f"    Significance:        {sig}")
        lines.append(f"  ")
        lines.append(f"  Effect size:")
        lines.append(f"    Cohen's d:           {result['cohens_d']}")
        
        # Interpret effect size
        d = abs(result['cohens_d'])
        if d < 0.2:
            effect_interp = "negligible"
        elif d < 0.5:
            effect_interp = "small"
        elif d < 0.8:
            effect_interp = "medium"
        else:
            effect_interp = "large"
        lines.append(f"    Interpretation:      {effect_interp}")
    
    lines.append("")
    
    # Demographics
    lines.append("## DEMOGRAPHICS BREAKDOWN")
    lines.append("-" * 40)
    demo = summary.get('demographics', {})
    
    for category, counts in demo.items():
        lines.append(f"\n{category.replace('_', ' ').title()}:")
        for value, count in counts.items():
            lines.append(f"  - {value}: {count}")
    
    lines.append("")
    
    # Questionnaire Analysis
    lines.append("## QUESTIONNAIRE RESPONSES")
    lines.append("-" * 40)
    quest = analyze_questionnaires(df)
    
    if 'pre_questionnaire' in quest:
        lines.append("\nPre-Questionnaire (1-5 Likert scale):")
        for q, stats in quest['pre_questionnaire'].items():
            lines.append(f"  {q}: mean={stats['mean']}, std={stats['std']}, n={stats['n']}")
    
    if 'post_questionnaire' in quest:
        lines.append("\nPost-Questionnaire (1-5 Likert scale):")
        for q, stats in quest['post_questionnaire'].items():
            lines.append(f"  {q}: mean={stats['mean']}, std={stats['std']}, n={stats['n']}")
    
    lines.append("")
    
    # Dropout Analysis
    lines.append("## DROPOUT ANALYSIS")
    lines.append("-" * 40)
    step_dist = summary.get('stepDistribution', {})
    lines.append("Sessions by step (potential dropout points):")
    for step, count in sorted(step_dist.items(), key=lambda x: x[1], reverse=True):
        lines.append(f"  {step}: {count}")
    
    lines.append("")
    
    # Qualitative Responses Summary
    lines.append("## QUALITATIVE RESPONSES")
    lines.append("-" * 40)
    qualitative = extract_qualitative_responses(data)
    lines.append(f"Total responses with open-ended feedback: {len(qualitative)}")
    
    if qualitative:
        lines.append("\nSample responses (first 5):")
        for i, resp in enumerate(qualitative[:5], 1):
            lines.append(f"\n--- Response {i} ---")
            for key, value in resp.items():
                if key not in ['session_id', 'completed'] and value:
                    lines.append(f"  {key}: {value[:200]}..." if len(value) > 200 else f"  {key}: {value}")
    
    lines.append("")
    lines.append("=" * 70)
    lines.append("END OF REPORT")
    lines.append("=" * 70)
    
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description='Analyze CO2 experiment data')
    parser.add_argument('--server', default='http://localhost:3001',
                        help='Server URL (default: http://localhost:3001)')
    parser.add_argument('--completed-only', action='store_true',
                        help='Only analyze completed sessions')
    parser.add_argument('--output', default='./analysis_output',
                        help='Output directory for reports and charts')
    
    args = parser.parse_args()
    
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    try:
        # Fetch data
        data = fetch_experiment_data(args.server, args.completed_only)
        summary = fetch_summary(args.server)
        
        if data.get('count', 0) == 0:
            print("⚠️  No experiment data found!")
            sys.exit(1)
        
        print(f"✅ Retrieved {data['count']} sessions ({data.get('completedCount', 0)} completed)")
        
        # Create DataFrame
        df = create_dataframe(data)
        
        # Save raw data
        df.to_csv(output_dir / 'experiment_data.csv', index=False)
        print(f"📁 Raw data saved to {output_dir / 'experiment_data.csv'}")
        
        # Save full JSON (includes nested data)
        with open(output_dir / 'experiment_data_full.json', 'w') as f:
            json.dump(data, f, indent=2, default=str)
        print(f"📁 Full JSON saved to {output_dir / 'experiment_data_full.json'}")
        
        # Extract qualitative responses
        qualitative = extract_qualitative_responses(data)
        if qualitative:
            with open(output_dir / 'qualitative_responses.json', 'w') as f:
                json.dump(qualitative, f, indent=2, ensure_ascii=False)
            print(f"📁 Qualitative responses saved to {output_dir / 'qualitative_responses.json'}")
        
        # Generate charts
        generate_charts(df, output_dir)
        
        # Generate report
        report = generate_report(df, data, summary, output_dir)
        report_path = output_dir / 'analysis_report.txt'
        with open(report_path, 'w') as f:
            f.write(report)
        
        print(f"\n📊 Analysis report saved to {report_path}")
        print("\n" + "=" * 50)
        print(report)
        
    except requests.exceptions.ConnectionError:
        print(f"❌ Could not connect to server at {args.server}")
        print("   Make sure the server is running: npm run dev")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
