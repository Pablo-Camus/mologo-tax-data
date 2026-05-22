import json, os, re
import anthropic

client = anthropic.Anthropic(api_key=os.environ["CLAUDE_API_KEY"])

with open("tax-data.json", "r") as f:
    current = json.load(f)

prompt = f"""You are a tax data verification assistant.

Here is the current tax rate data for multiple countries in JSON format:
{json.dumps(current, indent=2)}

For each country, use web search to verify the current VAT/GST standard rate (vs), 
reduced rates (vr), and withholding rates (wr) are still accurate.

Return ONLY a JSON object containing entries that need updating, using the same structure.
If nothing has changed, return an empty object {{}}.
Only include fields that actually changed — do not include unchanged fields.
Do not include any explanation, just the JSON."""

response = client.messages.create(
    model="claude-opus-4-5",
    max_tokens=4096,
    tools=[{"type": "web_search_20250305", "name": "web_search"}],
    messages=[{"role": "user", "content": prompt}]
)

raw = ""
for block in response.content:
    if hasattr(block, "text"):
        raw += block.text

match = re.search(r'\{[\s\S]*\}', raw)
if not match:
    print("No JSON found in response, no changes made.")
    exit(0)

updates = json.loads(match.group())
if not updates:
    print("No rate changes detected.")
    exit(0)

for code, data in updates.items():
    if code in current:
        current[code].update(data)
    else:
        current[code] = data

with open("tax-data.json", "w") as f:
    json.dump(current, f, indent=2, ensure_ascii=False)

print(f"Updated {len(updates)} country/countries: {list(updates.keys())}")
