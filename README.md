# Automated Tests Dashboard

A clean, TestRail-inspired dashboard for viewing automated test results.

## Overview

This dashboard displays the results of automated end-to-end tests for the Suter web application. It provides a clear overview of test execution status across different test suites.

## Setup

After updating test artifacts, regenerate the artifacts index:

```bash
node generate-artifacts-index.js
```

This will scan the `artifacts/` folder and update `artifacts-index.json` with the latest test results and deployment timestamp.

## Features

- **Test Status Overview** — See pass/fail/not tested counts at a glance
- **Detailed Test Steps** — Expand any test to view individual step results with screenshots
- **Dark/Light Mode** — Toggle between themes for comfortable viewing
- **Real-time Clocks** — Lupfig and Kyiv time zones displayed
- **Last Deployed** — Shows when test results were last updated

## Test Suites

The dashboard tracks the following test suites:

- **Create Offer** — Tests for creating proposals across different business units (E4R, HAG, HKU, SET, SUD, SUR, DIV)
- **Project Lifecycle** — End-to-end project workflow tests from offer to invoicing
