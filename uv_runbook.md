# DS210 Capstone

## Environment Setup

This project uses **Python 3.11** and **uv** for Python environment and package management.

---

## 1. Install uv

If uv is not already installed, install it using PowerShell.

### Windows

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

After installation, restart your terminal and verify that uv is installed:

```powershell
uv --version
```

---

## 2. Clone the Repository

Clone the GitHub repository:

```powershell
git clone https://github.com/UC-Berkeley-I-School/DS210_Capstone.git
```

Move into the project directory:

```powershell
cd DS210_Capstone
```

---

## 3. Set Up the Python Environment

The project uses **Python 3.11**.

Install Python 3.11 through uv if needed:

```powershell
uv python install 3.11
```

Then install the project's dependencies:

```powershell
uv sync
```

`uv sync` will automatically create a virtual environment at:

```text
.venv/
```

and install the dependencies defined in:

```text
pyproject.toml
```

using the versions recorded in:

```text
uv.lock
```

You do **not** need to manually create or activate the virtual environment.

---

# Adding Packages

Do not use `pip install` to add project dependencies.

Instead, use:

```powershell
uv add package-name
```

For example:

```powershell
uv add pandas
```

Multiple packages can be installed at once:

```powershell
uv add numpy pandas matplotlib scikit-learn
```

For development packages such as Jupyter:

```powershell
uv add --dev jupyter ipykernel
```

When packages are added, uv automatically updates:

- `pyproject.toml`
- `uv.lock`

Both of these files should be committed to GitHub.

After pulling changes from another team member, run:

```powershell
git pull
uv sync
```

This will ensure your local environment matches the project environment.

---

# Running Python Files

Python files can be run through the uv environment from the terminal.

For example:

```powershell
uv run python test_env.py
```

Or:

```powershell
uv run python path/to/script.py
```

Using `uv run` ensures that Python uses the dependencies installed in the project's `.venv`.

---

# Running Python Files in VS Code

Open the project in VS Code:

```powershell
code .
```

Select the project's Python interpreter:

1. Press `Ctrl + Shift + P`
2. Search for `Python: Select Interpreter`
3. Select the interpreter located at:

```text
.venv\Scripts\python.exe
```

Python files can then be run directly inside VS Code.

---

# Running Jupyter Notebooks in VS Code

Make sure the **Python** and **Jupyter** VS Code extensions are installed.

Open an existing `.ipynb` file or create a new Jupyter Notebook.

In the top-right corner of the notebook:

1. Click **Select Kernel**
2. Select **Python Environments**
3. Select:

```text
.venv\Scripts\python.exe
```

You can verify that the notebook is using the correct environment by running:

```python
import sys

print(sys.executable)
```

The output should point to the project's `.venv`, for example:

```text
C:\path\to\DS210_Capstone\.venv\Scripts\python.exe
```

You can then run notebook cells normally inside VS Code.

---

# Running JupyterLab From the Command Line

JupyterLab can also be launched through uv:

```powershell
uv run jupyter lab
```

Jupyter will start a local server and should automatically open JupyterLab in your web browser.

If the browser does not open automatically, the terminal will display a URL similar to:

```text
http://localhost:8888/lab?token=...
```

Copy and paste the URL into your browser.

To stop the Jupyter server, return to the terminal and press:

```text
Ctrl + C
```

---

# Typical Development Workflow

When starting work:

```powershell
git pull
uv sync
```

To add a new package:

```powershell
uv add package-name
```

To run a Python file:

```powershell
uv run python script.py
```

To launch JupyterLab:

```powershell
uv run jupyter lab
```

For Jupyter notebooks inside VS Code, simply make sure the `.venv` kernel is selected.

---

# Important Project Files

```text
DS210_Capstone/
│
├── .python-version     # Python version used by the project
├── .venv/              # Local virtual environment (DO NOT COMMIT)
├── pyproject.toml      # Project dependencies and configuration
├── uv.lock             # Exact dependency versions
├── notebooks/          # Jupyter notebooks
└── README.md
```

## Important Git Notes

The `.venv` directory should **not** be committed to GitHub.

Each team member creates their own `.venv` by running:

```powershell
uv sync
```

The following files **should be committed**:

```text
.python-version
pyproject.toml
uv.lock
```

This allows every team member to recreate the same Python environment.

---

# Quick Environment Test

To verify that the environment is working correctly, run:

```powershell
uv run python --version
```

You should see Python 3.11.

You can also verify the location of the Python interpreter:

```powershell
uv run python -c "import sys; print(sys.executable)"
```

The path should point to:

```text
DS210_Capstone\.venv\Scripts\python.exe
```