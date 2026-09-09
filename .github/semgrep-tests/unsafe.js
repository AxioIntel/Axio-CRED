// Scanner fixtures only; this file is never executed.
// ruleid: axiocred-no-disabled-tls
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
// ruleid: axiocred-no-disabled-tls
const insecure = {rejectUnauthorized: false};
// ok: axiocred-no-disabled-tls
const secure = {rejectUnauthorized: true};

// ruleid: axiocred-no-dynamic-code
eval(untrusted);
// ruleid: axiocred-no-dynamic-code
new Function(untrusted);
// ok: axiocred-no-dynamic-code
JSON.parse(untrusted);

// ruleid: axiocred-no-secret-response
res.json(process.env);
// ok: axiocred-no-secret-response
res.json({configured: Boolean(process.env.OPENAI_API_KEY)});

// ruleid: axiocred-no-shell-execution
spawn(command, args, {shell: true});
// ok: axiocred-no-shell-execution
spawn(command, args, {shell: false});
