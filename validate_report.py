import json
import sys

def validate_report(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)

        if not isinstance(data, list):
            print("Error: Root element must be a JSON array.")
            return False

        required_keys = ["title", "description", "deepLink", "filePath", "lineNumber", "confidence", "rationale", "context", "language"]

        for index, item in enumerate(data):
            for key in required_keys:
                if key not in item:
                    print(f"Error: Item at index {index} is missing key '{key}'.")
                    return False

            if not isinstance(item["confidence"], int) or not (1 <= item["confidence"] <= 3):
                print(f"Error: Item at index {index} has invalid confidence score. Must be int 1-3.")
                return False

            # Check for strings
            for key in ["title", "description", "deepLink", "filePath", "rationale", "context", "language"]:
                 if not isinstance(item[key], str):
                    print(f"Error: Item at index {index} key '{key}' must be a string.")
                    return False

            if not isinstance(item["lineNumber"], int):
                 print(f"Error: Item at index {index} key 'lineNumber' must be an integer.")
                 return False

        print("Validation successful!")
        return True

    except json.JSONDecodeError as e:
        print(f"JSON Decode Error: {e}")
        return False
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        return False

if __name__ == "__main__":
    if not validate_report("todo_report.json"):
        sys.exit(1)
