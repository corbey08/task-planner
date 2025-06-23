export async function handler(event, context) {
  const apiKey = process.env.OPENAIP_API_KEY;

  try {
    const response = await fetch('https://api.openaip.net/api/airspace', {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: `OpenAIP error: ${response.statusText}` })
      };
    }

    const data = await response.json();

    return {
      statusCode: 200,
      body: JSON.stringify(data)
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error', details: error.message })
    };
  }
}