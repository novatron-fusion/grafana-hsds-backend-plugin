use bytes::Bytes;
use chrono::prelude::*;
use futures::StreamExt;
use http::Response;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{debug, error, info};

use grafana_plugin_sdk::{backend, data, prelude::*};
use hsds_client::{HsdsClient, BasicAuth, HsdsResult};

#[derive(Clone, Debug, GrafanaPlugin)]
#[grafana_plugin(plugin_type = "datasource")]
struct HsdsPluginService;

impl HsdsPluginService {
    fn new() -> Self {
        Self
    }

    /// Create an HSDS client from plugin context
    async fn create_client(
        ctx: &backend::PluginContext<
            backend::DataSourceInstanceSettings<serde_json::Value, serde_json::Value>,
            serde_json::Value,
            serde_json::Value
        >,
    ) -> Result<HsdsClient, Box<dyn std::error::Error>> {
        let settings = ctx
            .instance_settings
            .as_ref()
            .ok_or("Missing instance settings")?;

        // Parse HsdsConfig from jsonData 
        let config: HsdsConfig = serde_json::from_value(settings.json_data.clone())
            .map_err(|e| format!("Failed to parse config: {}", e))?;

        let hsds_url = config.hsds_url
            .ok_or("HSDS URL not configured")?;

        let username = settings
            .decrypted_secure_json_data
            .as_object()
            .and_then(|data| data.get("username"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| "admin".to_string());

        let password = settings
            .decrypted_secure_json_data
            .as_object()
            .and_then(|data| data.get("password"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| "admin".to_string());

        HsdsClient::new(&hsds_url, BasicAuth::new(&username, &password))
            .map_err(|e| format!("Failed to create HSDS client: {}", e).into())
    }
}

/// Plugin configuration from datasource settings
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HsdsConfig {
    hsds_url: Option<String>,
    domain: Option<String>,
}

/// Query model for selecting datasets
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HsdsQuery {
    /// HDF5 domain path (e.g., "/home/user/file.h5")
    domain: String,
    /// Selected measurements to query
    /// Format: Vec<(measurement_name, x_dataset_path, y_dataset_path)>
    measurements: Vec<MeasurementSelection>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct MeasurementSelection {
    name: String,
    x_path: String,
    y_path: String,
}

#[derive(Debug, Error)]
#[error("Error querying HSDS for {}: {}", .ref_id, .message)]
struct QueryError {
    ref_id: String,
    message: String,
}

impl backend::DataQueryError for QueryError {
    fn ref_id(self) -> String {
        self.ref_id
    }
}

#[async_trait::async_trait]
impl backend::DataService for HsdsPluginService {
    type Query = HsdsQuery;
    type QueryError = QueryError;
    type Stream = backend::BoxDataResponseStream<Self::QueryError>;
    
    async fn query_data(
        &self,
        request: backend::QueryDataRequest<Self::Query, Self>,
    ) -> Self::Stream {
        info!(queries = request.queries.len(), "Querying HSDS data");

        let plugin_ctx = request.plugin_context.clone();

        Box::pin(futures::stream::iter(
            request
                .queries
                .into_iter()
               .map(move |query_req| {
                   let ctx = plugin_ctx.clone();
                   async move {
                    let ref_id = query_req.ref_id.clone();
                    
                    // Create HSDS client
                    let client = match Self::create_client(&ctx).await {
                        Ok(client) => client,
                        Err(e) => {
                            error!("Failed to create HSDS client: {}", e);
                            return Err(QueryError {
                                ref_id,
                                message: format!("Failed to create client: {}", e),
                            });
                        }
                    };

                    let query = query_req.query;
                    let domain = &query.domain;
                    
                    debug!(
                        domain = %domain,
                        measurements = query.measurements.len(),
                        "Processing query"
                    );

                    // Query each measurement
                    let mut frames = Vec::new();

                    for measurement in &query.measurements {
                        match query_measurement(&client, domain, measurement).await {
                            Ok(frame) => {
                                // Validate frame structure
                                if let Err(e) = frame.check() {
                                    error!(
                                        measurement = %measurement.name,
                                        error = %e,
                                        "Frame validation failed"
                                    );
                                    return Err(QueryError {
                                        ref_id: ref_id.clone(),
                                        message: format!("Frame validation for {} failed: {}", measurement.name, e),
                                    });
                                }
                                frames.push(frame);
                            }
                            Err(e) => {
                                error!(
                                    measurement = %measurement.name,
                                    error = %e,
                                    "Failed to query measurement"
                                );
                                return Err(QueryError {
                                    ref_id: ref_id.clone(),
                                    message: format!("Failed to query {}: {}", measurement.name, e),
                                });
                            }
                        }
                    }

                    info!(frames = frames.len(), "Query completed successfully");
                    
                    // Convert frames to CheckedFrames for response
                    let checked_frames: Vec<_> = frames.iter()
                        .filter_map(|f| f.check().ok())
                        .collect();
                    
                    Ok(backend::DataResponse::new(ref_id, checked_frames))
                }})
                .collect::<Vec<_>>()
        ).then(|future| future))
    }
}

/// Query a single measurement and return a Grafana frame
async fn query_measurement(
    client: &HsdsClient,
    domain: &str,
    measurement: &MeasurementSelection,
) -> HsdsResult<data::Frame> {
    use hsds_client::deserialize_values;
    
    debug!(
        domain = %domain,
        measurement = %measurement.name,
        x_path = %measurement.x_path,
        y_path = %measurement.y_path,
        "Querying measurement datasets"
    );

    // Resolve dataset paths to IDs
    let (x_id, _) = client.resolve_path(domain, &measurement.x_path).await?;
    let (y_id, _) = client.resolve_path(domain, &measurement.y_path).await?;

    // Get dataset metadata
    let x_meta = client.datasets().get_dataset(domain, &x_id).await?;
    let y_meta = client.datasets().get_dataset(domain, &y_id).await?;

    // Calculate expected lengths
    let x_len = x_meta.shape.as_ref()
        .and_then(|s| s.dims.as_ref().and_then(|d| d.get(0).copied()))
        .unwrap_or(0) as usize;
    let y_len = y_meta.shape.as_ref()
        .and_then(|s| s.dims.as_ref().and_then(|d| d.get(0).copied()))
        .unwrap_or(0) as usize;

    debug!(
        x_len = x_len,
        y_len = y_len,
        "Dataset dimensions"
    );

    // Read binary data
    let x_bytes = client.datasets().read_dataset_values(domain, &x_id, None, None, None).await?;
    let y_bytes = client.datasets().read_dataset_values(domain, &y_id, None, None, None).await?;

    // Deserialize to typed values
    let x_dtype = x_meta.data_type.as_ref()
        .ok_or_else(|| hsds_client::HsdsError::InvalidResponse("Missing x data type".to_string()))?;
    let y_dtype = y_meta.data_type.as_ref()
        .ok_or_else(|| hsds_client::HsdsError::InvalidResponse("Missing y data type".to_string()))?;

    let x_values = deserialize_values(&x_bytes, x_dtype, x_len)?;
    let y_values = deserialize_values(&y_bytes, y_dtype, y_len)?;

    // Convert to f64 for Grafana (time series format)
    let x_floats = x_values.to_f64();
    let y_floats = y_values.to_f64();

    debug!(
        x_count = x_floats.len(),
        y_count = y_floats.len(),
        "Converted to f64 arrays"
    );

    // Create Grafana frame
    // Assuming x_data is timestamp-like, convert to DateTime
    let time_field = x_floats
        .into_iter()
        .map(|t| {
            // Convert float timestamp to DateTime
            // Assuming seconds since epoch
            let secs = t as i64;
            let nanos = ((t - secs as f64) * 1_000_000_000.0) as u32;
            DateTime::<Utc>::from_timestamp(secs, nanos)
                .unwrap_or_else(|| Utc::now())
        })
        .collect::<Vec<_>>()
        .into_field("time");

    let value_field = y_floats.into_field(&measurement.name);

    // Create and validate frame
    let frame = [time_field, value_field]
        .into_frame(&measurement.name);
    
    // Validate frame structure
    frame.check()
        .map_err(|e| hsds_client::HsdsError::InvalidResponse(format!("Frame validation failed: {}", e)))?;

    Ok(frame)
}

#[derive(Debug, Error)]
enum ResourceError {
    #[error("HTTP error: {0}")]
    Http(#[from] http::Error),

    #[error("HSDS error: {0}")]
    Hsds(String),

    #[error("Not found")]
    NotFound,

    #[error("Bad request: {0}")]
    BadRequest(String),
}

impl backend::ErrIntoHttpResponse for ResourceError {
    fn into_http_response(self) -> Result<http::Response<Bytes>, Box<dyn std::error::Error>> {
        let status = match &self {
            Self::Http(_) | Self::Hsds(_) => http::StatusCode::INTERNAL_SERVER_ERROR,
            Self::NotFound => http::StatusCode::NOT_FOUND,
            Self::BadRequest(_) => http::StatusCode::BAD_REQUEST,
        };
        Ok(Response::builder()
            .status(status)
            .header(http::header::CONTENT_TYPE, "application/json")
            .body(Bytes::from(
                serde_json::json!({
                    "error": self.to_string()
                })
                .to_string(),
            ))?)
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TreeNode {
    name: String,
    path: String,
    node_type: String, // "group", "dataset"
    id: String,
    has_children: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DatasetMetadata {
    name: String,
    path: String,
    id: String,
    dtype: String,
    shape: Vec<u64>,
}

#[async_trait::async_trait]
impl backend::ResourceService for HsdsPluginService {
    type Error = ResourceError;
    type InitialResponse = http::Response<Bytes>;
    type Stream = backend::BoxResourceStream<Self::Error>;
    
    async fn call_resource(
        &self,
        r: backend::CallResourceRequest<Self>,
    ) -> Result<(Self::InitialResponse, Self::Stream), Self::Error> {
        let path = r.request.uri().path();
        let query = r.request.uri().query().unwrap_or("");
        
        info!("Resource request: {} {}", path, query);

        // Create HSDS client
        let client = Self::create_client(&r.plugin_context)
            .await
            .map_err(|e| ResourceError::Hsds(e.to_string()))?;

        let response = match path {
            // List all available domains
            "/domains" => {
                debug!("Listing domains");
                let domains = client.domains().list_domains()
                    .await
                    .map_err(|e| ResourceError::Hsds(e.to_string()))?;

                let json = serde_json::to_string(&domains)
                    .map_err(|e| ResourceError::Hsds(e.to_string()))?;

                Response::builder()
                    .status(200)
                    .header(http::header::CONTENT_TYPE, "application/json")
                    .body(Bytes::from(json))?
            }

            // Get root children of a domain
            "/tree-root" => {
                let params: std::collections::HashMap<_, _> =
                    url::form_urlencoded::parse(query.as_bytes()).collect();

                let domain = params
                    .get("domain")
                    .ok_or_else(|| ResourceError::BadRequest("Missing domain parameter".to_string()))?;

                debug!(domain = %domain, "Getting root tree");

                // Get domain info to find root group
                let domain_info = client.domains().get_domain(domain)
                    .await
                    .map_err(|e| ResourceError::Hsds(e.to_string()))?;

                let root_id = domain_info
                    .root
                    .ok_or_else(|| ResourceError::Hsds("Domain has no root".to_string()))?;

                // List children
                let children = client.list_children(domain, &root_id)
                    .await
                    .map_err(|e| ResourceError::Hsds(e.to_string()))?;

                let nodes: Vec<TreeNode> = children
                    .into_iter()
                    .map(|(name, id, collection)| TreeNode {
                        name: name.clone(),
                        path: format!("/{}", name),
                        node_type: if collection == "groups" {
                            "group".to_string()
                        } else {
                            "dataset".to_string()
                        },
                        id,
                        has_children: collection == "groups",
                    })
                    .collect();

                let json = serde_json::to_string(&nodes)
                    .map_err(|e| ResourceError::Hsds(e.to_string()))?;

                Response::builder()
                    .status(200)
                    .header(http::header::CONTENT_TYPE, "application/json")
                    .body(Bytes::from(json))?
            }

            // Expand a specific group node
            "/tree-expand" => {
                let params: std::collections::HashMap<_, _> =
                    url::form_urlencoded::parse(query.as_bytes()).collect();

                let domain = params
                    .get("domain")
                    .ok_or_else(|| ResourceError::BadRequest("Missing domain parameter".to_string()))?;

                let node_path = params
                    .get("path")
                    .ok_or_else(|| ResourceError::BadRequest("Missing path parameter".to_string()))?;

                debug!(domain = %domain, path = %node_path, "Expanding tree node");

                // Resolve path to get group ID
                let (group_id, collection) = client.resolve_path(domain, node_path)
                    .await
                    .map_err(|e| ResourceError::Hsds(e.to_string()))?;

                if collection != "groups" {
                    return Err(ResourceError::BadRequest("Path is not a group".to_string()));
                }

                // List children
                let children = client.list_children(domain, &group_id)
                    .await
                    .map_err(|e| ResourceError::Hsds(e.to_string()))?;

                let base_path = if node_path.as_ref() == "/" {
                    "".to_string()
                } else {
                    node_path.to_string()
                };

                let nodes: Vec<TreeNode> = children
                    .into_iter()
                    .map(|(name, id, collection)| TreeNode {
                        name: name.clone(),
                        path: format!("{}/{}", base_path, name),
                        node_type: if collection == "groups" {
                            "group".to_string()
                        } else {
                            "dataset".to_string()
                        },
                        id,
                        has_children: collection == "groups",
                    })
                    .collect();

                let json = serde_json::to_string(&nodes)
                    .map_err(|e| ResourceError::Hsds(e.to_string()))?;

                Response::builder()
                    .status(200)
                    .header(http::header::CONTENT_TYPE, "application/json")
                    .body(Bytes::from(json))?
            }

            // Get dataset metadata
            "/dataset-meta" => {
                let params: std::collections::HashMap<_, _> =
                    url::form_urlencoded::parse(query.as_bytes()).collect();

                let domain = params
                    .get("domain")
                    .ok_or_else(|| ResourceError::BadRequest("Missing domain parameter".to_string()))?;

                let dataset_path = params
                    .get("path")
                    .ok_or_else(|| ResourceError::BadRequest("Missing path parameter".to_string()))?;

                debug!(domain = %domain, path = %dataset_path, "Getting dataset metadata");

                // Resolve path to get dataset ID
                let (dataset_id, collection) = client.resolve_path(domain, dataset_path)
                    .await
                    .map_err(|e| ResourceError::Hsds(e.to_string()))?;

                if collection != "datasets" {
                    return Err(ResourceError::BadRequest("Path is not a dataset".to_string()));
                }

                // Get dataset metadata
                let meta = client.datasets().get_dataset(domain, &dataset_id)
                    .await
                    .map_err(|e| ResourceError::Hsds(e.to_string()))?;

                let dtype_str = format!("{:?}", meta.data_type);

                let metadata = DatasetMetadata {
                    name: dataset_path.split('/').last().unwrap_or("").to_string(),
                    path: dataset_path.to_string(),
                    id: dataset_id,
                    dtype: dtype_str,
                    shape: meta.shape
                        .and_then(|s| s.dims)
                        .unwrap_or_default(),
                };

                let json = serde_json::to_string(&metadata)
                    .map_err(|e| ResourceError::Hsds(e.to_string()))?;

                Response::builder()
                    .status(200)
                    .header(http::header::CONTENT_TYPE, "application/json")
                    .body(Bytes::from(json))?
            }

            _ => return Err(ResourceError::NotFound),
        };

        Ok((response, Box::pin(futures::stream::empty())))
    }
}

#[grafana_plugin_sdk::main(
    services(data, resource),
    init_subscriber = true,
    shutdown_handler = "0.0.0.0:10002"
)]
async fn plugin() -> HsdsPluginService {
    HsdsPluginService::new()
}
