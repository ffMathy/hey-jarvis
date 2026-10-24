/**
 * A post-call transcription as ElevenLabs sends it, trimmed of nothing the schema reads: the example
 * in ElevenLabs' post-call webhook documentation, with Jarvis's criterion and a routed tool call.
 */
export const FAILED_CONVERSATION_PAYLOAD = {
  type: 'post_call_transcription',
  event_timestamp: 1739537297,
  data: {
    agent_id: 'agent_jarvis',
    conversation_id: 'conv_failed',
    status: 'done',
    user_id: null,
    transcript: [
      {
        role: 'agent',
        message: 'Good evening, sir.',
        tool_calls: null,
        tool_results: null,
        feedback: null,
        llm_override: null,
        time_in_call_secs: 0,
        conversation_turn_metrics: null,
        rag_retrieval_info: null,
        llm_usage: null,
      },
      {
        role: 'user',
        message: 'Turn off the kitchen lights.',
        tool_calls: null,
        tool_results: null,
        time_in_call_secs: 3,
      },
      {
        role: 'agent',
        message: null,
        tool_calls: [
          {
            type: 'mcp',
            request_id: 'request_1',
            tool_name: 'routePromptWorkflow',
            params_as_json: '{"prompt":"Turn off the kitchen lights"}',
            tool_has_been_called: true,
          },
        ],
        tool_results: [
          {
            request_id: 'request_1',
            tool_name: 'routePromptWorkflow',
            result_value: '{"error":"Home Assistant is unreachable"}',
            is_error: true,
            tool_has_been_called: true,
          },
        ],
        time_in_call_secs: 4,
      },
      { role: 'agent', message: 'Done, sir.', time_in_call_secs: 71 },
    ],
    metadata: { start_time_unix_secs: 1739537297, call_duration_secs: 75, cost: 296 },
    analysis: {
      evaluation_criteria_results: {
        the_user_was_satisfied: {
          criteria_id: 'the_user_was_satisfied',
          result: 'failure',
          rationale: 'The agent claimed the lights were off although the tool failed.',
        },
        another_criterion: { criteria_id: 'another_criterion', result: 'unknown', rationale: 'Not enough to go on.' },
      },
      data_collection_results: {},
      call_successful: 'success',
      transcript_summary: 'Sir asked for the kitchen lights to be turned off.',
    },
    conversation_initiation_client_data: { dynamic_variables: {} },
  },
};
